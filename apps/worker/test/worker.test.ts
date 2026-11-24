import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createWatchFromTemplate } from "@sheetdot/shared";
import { WorkbookEngine, type AlarmScheduler, type SqlRunner } from "../src/workbook-do.js";

function createTestEngine() {
  const db = new DatabaseSync(":memory:");
  const scheduledAlarms: number[] = [];

  const sql: SqlRunner = {
    exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] {
      const stmt = db.prepare(query);
      const trimmed = query.trim().toUpperCase();
      if (trimmed.startsWith("SELECT")) {
        return stmt.all(...(bindings as never[])) as unknown as T[];
      }
      stmt.run(...(bindings as never[]));
      return [];
    },
  };

  const alarmScheduler: AlarmScheduler = {
    async setAlarm(scheduledTimeMs: number) {
      scheduledAlarms.push(scheduledTimeMs);
    },
    async getAlarm() {
      return scheduledAlarms.at(-1) ?? null;
    },
  };

  const engine = new WorkbookEngine(sql, alarmScheduler, {
    MOCK_MODE: "true",
    DEFAULT_TIMEZONE: "Asia/Kolkata",
  });

  return { engine, db, scheduledAlarms };
}

describe("WorkbookEngine (SQLite Durable Object core)", () => {
  it("caches AI.ASK responses by SHA-256 of (question + rowValues)", async () => {
    const { engine } = createTestEngine();

    const first = await engine.handleAsk({
      workbookId: "wb-1",
      question: "What is the total amount?",
      rowValues: [
        ["Airtel", 1179],
        ["BESCOM", 4850],
      ],
    });
    expect(first.cached).toBe(false);
    expect(first.answer).toContain("6,029");

    // Identical question + rowValues must hit answer_cache
    const second = await engine.handleAsk({
      workbookId: "wb-1",
      question: "What is the total amount?",
      rowValues: [
        ["Airtel", 1179],
        ["BESCOM", 4850],
      ],
    });
    expect(second.cached).toBe(true);
    expect(second.answer).toBe(first.answer);

    // Changed rowValues must bypass cache and recompute
    const third = await engine.handleAsk({
      workbookId: "wb-1",
      question: "What is the total amount?",
      rowValues: [
        ["Airtel", 1179],
        ["BESCOM", 5000],
      ],
    });
    expect(third.cached).toBe(false);
    expect(third.answer).toContain("6,179");
  });

  it("runs alarm(), populates pending_updates and agent_logs, detects anomalies, and deduplicates processed_emails", async () => {
    const { engine, db, scheduledAlarms } = createTestEngine();

    const watchInput = createWatchFromTemplate("bills", "wb-bills");
    const watch = await engine.upsertWatch(watchInput);

    expect(watch.id).toBeTruthy();
    expect(watch.nextRunAt).toBeTruthy();
    expect(scheduledAlarms.length).toBe(1);

    // 1. Trigger alarm() while Excel is closed
    const alarmResult = await engine.handleAlarm();
    expect(alarmResult.watchesRun).toBe(1);
    expect(alarmResult.logs).toHaveLength(1);
    expect(alarmResult.logs[0]!.status).toBe("success");
    expect(alarmResult.pendingUpdates.length).toBe(5);

    // Check BESCOM anomaly (>20% jump from Oct 2100 -> Nov 4850)
    const bescomNov = alarmResult.pendingUpdates.find((u) => u.matchKey === "bescom::2026-11");
    expect(bescomNov).toBeDefined();
    expect(bescomNov!.confidence).toBe("needs_review");
    expect(bescomNov!.sourceComment).toContain("Anomaly");

    // Check Airtel insert + subsequent payment update share deterministic matchKey
    const airtelUpdates = alarmResult.pendingUpdates.filter((u) => u.matchKey === "airtel::2026-11");
    expect(airtelUpdates).toHaveLength(2);
    expect(airtelUpdates[0]!.action).toBe("insert");
    expect(airtelUpdates[0]!.values.status).toBe("Unpaid");
    expect(airtelUpdates[1]!.action).toBe("update");
    expect(airtelUpdates[1]!.values.status).toBe("Paid");

    // Verify sync payload carries pending updates and logs
    const syncBeforeAck = await engine.getSyncPayload("wb-bills");
    expect(syncBeforeAck.pendingUpdates).toHaveLength(5);
    expect(syncBeforeAck.agentLogs).toHaveLength(1);

    // Verify processed_emails table recorded every scanned email message_id
    const processedRows = db.prepare("SELECT COUNT(*) as cnt FROM processed_emails").get() as {
      cnt: number;
    };
    expect(processedRows.cnt).toBe(7);

    // 2. Run alarm() a second time — processed_emails MUST prevent duplicate rows
    const secondAlarm = await engine.handleAlarm();
    expect(secondAlarm.pendingUpdates).toHaveLength(0);
    expect(secondAlarm.logs[0]!.emailsScanned).toBe(0);
    expect(secondAlarm.logs[0]!.rowsAdded).toBe(0);
    expect(secondAlarm.logs[0]!.rowsUpdated).toBe(0);

    // 3. Acknowledge applied updates
    const ackRes = engine.ackSync(syncBeforeAck.pendingUpdates.map((u) => u.id));
    expect(ackRes.acknowledged).toBe(5);

    const syncAfterAck = await engine.getSyncPayload("wb-bills");
    expect(syncAfterAck.pendingUpdates).toHaveLength(0);
  });

  it("supports =AI.WATCH cell registration and cached answer retrieval", async () => {
    const { engine } = createTestEngine();

    const first = await engine.handleWatchCell({
      workbookId: "wb-cell",
      question: "Total utility spend",
      rowValues: [[1179, 4850]],
      schedule: "daily",
    });
    expect(first.scheduleCron).toBe("0 8 * * *");
    expect(first.cached).toBe(false);
    expect(first.answer).toContain("6,029");

    const second = await engine.handleWatchCell({
      workbookId: "wb-cell",
      question: "Total utility spend",
      rowValues: [[1179, 4850]],
      schedule: "daily",
    });
    expect(second.cached).toBe(true);
    expect(second.watchId).toBe(first.watchId);
    expect(engine.listWatches()).toHaveLength(1);
  });
});
