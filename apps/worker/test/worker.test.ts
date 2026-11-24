import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createWatchFromTemplate } from "@sheetdot/shared";
import { signSessionToken, verifySessionToken } from "../src/auth.js";
import app from "../src/index.js";
import { WorkbookEngine, type AlarmScheduler, type SqlRunner } from "../src/workbook-do.js";

function createTestEngine(overrides?: { MOCK_MODE?: string }) {
  const db = new DatabaseSync(":memory:");
  const scheduledAlarms: number[] = [];

  const sql: SqlRunner = {
    exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] {
      const stmt = db.prepare(query);
      const trimmed = query.trim().toUpperCase();
      if (trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA")) {
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
    MOCK_MODE: overrides?.MOCK_MODE ?? "true",
    DEFAULT_TIMEZONE: "Asia/Kolkata",
    VAULT_SECRET: "test-vault-secret",
  });

  return { engine, db, scheduledAlarms };
}

describe("WorkbookEngine (Multi-Agent Overnight Control Plane)", () => {
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

  it("supports per-watch deduplication, entity aliases, locked PDF -> vault unlock, and batch revert", async () => {
    const { engine, db } = createTestEngine();

    const billsWatch = await engine.upsertWatch(createWatchFromTemplate("bills", "wb-bills"));
    // Second watch sharing overlapping Gmail queries
    const auditWatch = await engine.upsertWatch({
      workbookId: "wb-bills",
      name: "Card Audit",
      templateId: "custom",
      source: "gmail",
      sheetName: "CardAudit",
      scheduleCron: "0 8 * * *",
      composioQuery: "credit card OR statement",
      matchKeyColumns: ["merchant", "billing_month"],
      columns: ["merchant", "billing_month", "amount", "status"],
      enabled: true,
    });

    // 1. Trigger alarm with NO PDF password hint yet
    const firstRun = await engine.handleAlarm();
    expect(firstRun.watchesRun).toBe(2);
    expect(firstRun.digest.urgentItems.length).toBeGreaterThan(0);

    // Airtel Payments normalized to "airtel::2026-11" via entity alias!
    const airtelUpdates = firstRun.pendingUpdates.filter(
      (u) => u.watchId === billsWatch.id && u.matchKey === "airtel::2026-11"
    );
    expect(airtelUpdates).toHaveLength(2);
    expect(airtelUpdates[0]!.action).toBe("insert");
    expect(airtelUpdates[1]!.action).toBe("update");
    expect(airtelUpdates[1]!.values.status).toBe("Paid");

    // BESCOM spike flagged as needs_review
    const bescomNov = firstRun.pendingUpdates.find(
      (u) => u.watchId === billsWatch.id && u.matchKey === "bescom::2026-11"
    );
    expect(bescomNov?.confidence).toBe("needs_review");
    expect(bescomNov?.sourceComment).toContain("Anomaly");

    // SBI locked PDF flagged needs_review & NOT marked permanently processed yet
    const sbiLocked = firstRun.pendingUpdates.find(
      (u) => u.watchId === billsWatch.id && u.matchKey === "sbi card::2026-11"
    );
    expect(sbiLocked?.confidence).toBe("needs_review");
    expect(sbiLocked?.sourceComment).toContain("Locked PDF");

    // Card Audit watch also processed HDFC/SBI independently (composite (watch_id, message_id) PK!)
    const auditUpdates = firstRun.pendingUpdates.filter((u) => u.watchId === auditWatch.id);
    expect(auditUpdates.length).toBeGreaterThanOrEqual(2);

    // 2. Add matching encrypted PDF password hint to Vault -> Run Now unlocks SBI PDF!
    const addedHint = await engine.addPdfHint({
      label: "SBI Credit Card PDF",
      senderPattern: "sbicard.com",
      password: "demo-sbi-password",
      hintDescription: "Test vault secret",
    });
    expect(addedHint.hasPassword).toBe(true);

    const unlockRun = await engine.runWatchNow(billsWatch.id);
    expect(unlockRun).not.toBeNull();
    expect(unlockRun!.pendingUpdatesCount).toBe(1);

    const syncAfterUnlock = await engine.getSyncPayload("wb-bills");
    expect(syncAfterUnlock.pdfHints).toHaveLength(1);
    const unlockedSbi = syncAfterUnlock.pendingUpdates.find(
      (u) => u.watchId === billsWatch.id && u.matchKey === "sbi card::2026-11" && u.values.amount === 7640
    );
    expect(unlockedSbi).toBeDefined();
    expect(unlockedSbi!.confidence).toBe("high");

    // 3. Running bills watch again now deduplicates all messages (0 new)
    const repeatRun = await engine.runWatchNow(billsWatch.id);
    expect(repeatRun!.pendingUpdatesCount).toBe(0);

    // 4. Batch rollback reverts unapplied updates for that log entry
    const revertRes = engine.revertLogBatch(unlockRun!.logEntry.id);
    expect(revertRes.foundLog).toBe(true);
    expect(revertRes.revertedUpdates).toBe(1);

    const rowsRemaining = db
      .prepare("SELECT COUNT(*) as cnt FROM pending_updates WHERE applied = 0")
      .get() as { cnt: number };
    expect(rowsRemaining.cnt).toBe(firstRun.pendingUpdates.length);
  });

  it("re-evaluates =AI.WATCH cells on alarm(), runs Calendar/GitHub/SMS connectors, and auto-pauses on consecutive errors", async () => {
    const { engine } = createTestEngine();

    // 1. Cell watch registration + alarm re-evaluation
    const cellRes = await engine.handleWatchCell({
      workbookId: "wb-multi",
      question: "Total utility spend",
      rowValues: [[1179, 4850]],
      schedule: "daily",
    });
    expect(cellRes.scheduleCron).toBe("0 8 * * *");

    // 2. Calendar, GitHub, and SMS webhook watches
    await engine.upsertWatch({
      workbookId: "wb-multi",
      name: "Calendar Brief",
      templateId: "custom",
      source: "calendar",
      sheetName: "CalendarBrief",
      scheduleCron: "0 8 * * *",
      composioQuery: "flight OR tax",
      matchKeyColumns: ["event_id", "date"],
      columns: ["event_id", "title", "date", "time", "location", "status"],
      enabled: true,
    });

    await engine.upsertWatch({
      workbookId: "wb-multi",
      name: "GitHub Triage",
      templateId: "custom",
      source: "github",
      sheetName: "GitHubTriage",
      scheduleCron: "0 8 * * *",
      composioQuery: "is:open",
      matchKeyColumns: ["item_id", "repo"],
      columns: ["item_id", "repo", "title", "author", "updated_date", "status"],
      enabled: true,
    });

    await engine.upsertWatch({
      workbookId: "wb-multi",
      name: "UPI SMS Ledger",
      templateId: "custom",
      source: "sms_webhook",
      sheetName: "SmsLedger",
      scheduleCron: "0 8 * * *",
      composioQuery: "UPI",
      matchKeyColumns: ["merchant", "tx_date"],
      columns: ["merchant", "tx_date", "channel", "amount", "currency", "status"],
      enabled: true,
    });

    engine.ingestSmsWebhook({
      workbookId: "wb-multi",
      sender: "HDFCBK",
      body: "INR 450.00 debited at Swiggy via UPI on 2026-11-24.",
    });

    const alarmRes = await engine.handleAlarm();
    expect(alarmRes.watchesRun).toBe(4);
    expect(alarmRes.pendingUpdates.some((u) => u.watchId === cellRes.watchId)).toBe(true);
    expect(alarmRes.pendingUpdates.some((u) => u.matchKey.includes("cal_flight_6e214"))).toBe(true);
    expect(alarmRes.pendingUpdates.some((u) => u.matchKey.includes("pr-42"))).toBe(true);
    expect(alarmRes.pendingUpdates.some((u) => u.matchKey === "swiggy::2026-11-24")).toBe(true);

    // 3. Circuit breaker auto-pause after maxConsecutiveErrors when live auth is missing
    const { engine: liveEngine } = createTestEngine({ MOCK_MODE: "false" });
    const failingWatch = await liveEngine.upsertWatch({
      ...createWatchFromTemplate("bills", "wb-fail"),
      maxConsecutiveErrors: 2,
    });

    await liveEngine.runWatchNow(failingWatch.id);
    expect(liveEngine.getWatch(failingWatch.id)?.enabled).toBe(true);
    expect(liveEngine.getWatch(failingWatch.id)?.consecutiveErrors).toBe(1);

    await liveEngine.runWatchNow(failingWatch.id);
    const paused = liveEngine.getWatch(failingWatch.id);
    expect(paused?.enabled).toBe(false);
    expect(paused?.consecutiveErrors).toBe(2);
    expect(paused?.autoPausedReason).toContain("Auto-paused");
  });

  it("serves Google Sign-In start & Office messageParent callback HTML", async () => {
    const seenAuthProfiles: string[] = [];
    const fakeEnv = {
      MOCK_MODE: "true",
      VAULT_SECRET: "secret-1",
      WORKBOOK_DO: {
        idFromName: (name: string) => name,
        get: (id: string) => ({
          fetch: async (_url: string, init?: RequestInit) => {
            seenAuthProfiles.push(`${id}:${String(init?.body ?? "")}`);
            return Response.json({ ok: true });
          },
        }),
      },
    };

    const startRes = await app.request(
      "http://localhost:8787/api/auth/google/start?workbookId=main&returnOrigin=http://localhost:3000",
      { method: "GET" },
      fakeEnv as never
    );
    expect(startRes.status).toBe(200);
    const startJson = (await startRes.json()) as {
      mode: string;
      authUrl: string;
      mockSession?: { user: { email: string } };
    };
    expect(startJson.mode).toBe("mock");
    expect(startJson.mockSession?.user.email).toBe("vishal@gmail.com");
    expect(seenAuthProfiles[0]).toContain("google_vishal_gmail_com__main");

    const callbackRes = await app.request(
      "http://localhost:8787/api/auth/callback?returnOrigin=http://localhost:3000&email=test@gmail.com&name=Test+User",
      { method: "GET" },
      fakeEnv as never
    );
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain("Office.context.ui.messageParent");
    expect(html).toContain("test@gmail.com");
  });

  it("issues and verifies HMAC session tokens and isolates DO namespaces per Google account", async () => {
    const tokenA = await signSessionToken(
      {
        id: "google_vishal_gmail_com",
        email: "vishal@gmail.com",
        name: "Vishal Agrawal",
        initials: "VA",
      },
      "secret-1"
    );
    const verifiedA = await verifySessionToken(tokenA, "secret-1");
    expect(verifiedA?.email).toBe("vishal@gmail.com");
    expect(await verifySessionToken(tokenA, "wrong-secret")).toBeNull();

    // Tampered token rejected with 401
    const unauthRes = await app.request(
      "http://localhost:8787/api/auth/me",
      { headers: { Authorization: "Bearer invalid.token" } },
      { VAULT_SECRET: "secret-1" } as never
    );
    expect(unauthRes.status).toBe(401);

    // Captures Durable Object idFromName calls for two different Google users
    const seenIds: string[] = [];
    const fakeEnv = {
      MOCK_MODE: "true",
      VAULT_SECRET: "secret-1",
      WORKBOOK_DO: {
        idFromName(name: string) {
          seenIds.push(name);
          return name;
        },
        get() {
          return {
            fetch: async () => Response.json({ watches: [] }),
          };
        },
      },
    };

    const tokenB = await signSessionToken(
      {
        id: "google_alex_gmail_com",
        email: "alex@gmail.com",
        name: "Alex Rivera",
        initials: "AR",
      },
      "secret-1"
    );

    // Even if both pass workbookId=main (or try to pass another user's ID), DO stays strictly isolated!
    await app.request(
      "http://localhost:8787/api/watches?workbookId=main",
      { headers: { Authorization: `Bearer ${tokenA}` } },
      fakeEnv as never
    );
    await app.request(
      "http://localhost:8787/api/watches?workbookId=google_vishal_gmail_com__main",
      { headers: { Authorization: `Bearer ${tokenB}` } },
      fakeEnv as never
    );

    expect(seenIds[0]).toBe("google_vishal_gmail_com__main");
    expect(seenIds[1]).toBe("google_alex_gmail_com__main");
  });
});
