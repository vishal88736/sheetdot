import { DurableObject } from "cloudflare:workers";
import {
  computeMatchKey,
  computePrimaryEntityKey,
  type AgentLogEntry,
  type AskRequest,
  type AskResponse,
  type ComposioAuthResponse,
  type ConnectionAuthStatus,
  type PendingRowUpdate,
  type SyncPayload,
  type WatchCellRequest,
  type WatchCellResponse,
  type WatchConfig,
  type WatchUpsertSchema,
} from "@sheetdot/shared";
import { z } from "zod";
import {
  fetchGmailMessages,
  getComposioAuthStatus,
  isMockMode,
  type ComposioEnv,
} from "./composio.js";
import { computeNextRunTimestamp, normalizeScheduleInput } from "./cron.js";
import { sendMorningDigest } from "./digest.js";
import {
  answerSpreadsheetQuestion,
  extractRowFromEmail,
  type ExtractorEnv,
} from "./extractor.js";

export interface WorkerEnv extends ComposioEnv, ExtractorEnv {
  WORKBOOK_DO: DurableObjectNamespace;
  DEFAULT_TIMEZONE?: string;
  DIGEST_WEBHOOK_URL?: string;
}

export interface SqlRunner {
  exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): T[];
}

export interface AlarmScheduler {
  setAlarm(scheduledTimeMs: number): Promise<void>;
  getAlarm(): Promise<number | null>;
}

type WatchUpsertInput = z.infer<typeof WatchUpsertSchema>;

function canonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function hashAskInput(
  question: string,
  rowValues: AskRequest["rowValues"]
): Promise<string> {
  const input = `${question.trim()}::${canonicalizeJson(rowValues)}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getNumericAmount(values: Record<string, string | number>): number | null {
  for (const [key, val] of Object.entries(values)) {
    if (/(amount|total|price|cost|fee|balance)/i.test(key)) {
      const parsed = typeof val === "number" ? val : Number(String(val).replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Core workbook state & scheduling engine backed by the 5 required SQLite tables.
 * Decoupled from Cloudflare's DO wrapper so both `WorkbookDurableObject` and Vitest
 * unit tests exercise identical SQL queries and alarm logic.
 */
export class WorkbookEngine {
  private initialized = false;

  constructor(
    private readonly sql: SqlRunner,
    private readonly alarmScheduler: AlarmScheduler,
    private readonly env: ComposioEnv &
      ExtractorEnv & {
        DEFAULT_TIMEZONE?: string;
        DIGEST_WEBHOOK_URL?: string;
      }
  ) {}

  ensureSchema(): void {
    if (this.initialized) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS answer_cache (
        hash TEXT PRIMARY KEY,
        answer TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS watches (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS processed_emails (
        message_id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_updates (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        applied INTEGER DEFAULT 0
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_logs (
        id TEXT PRIMARY KEY,
        entry_json TEXT NOT NULL
      );
    `);

    // Supporting metadata for baseline anomaly detection and workbook connection state
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS known_records (
        match_key TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        values_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS workbook_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.initialized = true;
  }

  private getMeta(key: string): string | undefined {
    this.ensureSchema();
    const rows = this.sql.exec<{ value: string }>(
      "SELECT value FROM workbook_meta WHERE key = ?",
      key
    );
    return rows[0]?.value;
  }

  private setMeta(key: string, value: string): void {
    this.ensureSchema();
    this.sql.exec(
      `INSERT INTO workbook_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value
    );
  }

  async handleAsk(request: AskRequest): Promise<AskResponse> {
    this.ensureSchema();
    const hash = await hashAskInput(request.question, request.rowValues);

    const cachedRows = this.sql.exec<{ answer: string; source: string }>(
      "SELECT answer, source FROM answer_cache WHERE hash = ?",
      hash
    );

    if (cachedRows[0]) {
      return {
        answer: cachedRows[0].answer,
        source: cachedRows[0].source,
        cached: true,
      };
    }

    const result = await answerSpreadsheetQuestion(request.question, request.rowValues, this.env);
    const createdAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO answer_cache (hash, answer, source, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET answer = excluded.answer, source = excluded.source, created_at = excluded.created_at`,
      hash,
      result.answer,
      result.source,
      createdAt
    );

    return {
      answer: result.answer,
      source: result.source,
      cached: false,
    };
  }

  async handleWatchCell(request: WatchCellRequest): Promise<WatchCellResponse> {
    this.ensureSchema();
    const hash = await hashAskInput(request.question, request.rowValues);
    const watchId = `cell_${hash.slice(0, 12)}`;
    const scheduleCron = normalizeScheduleInput(request.schedule);

    const existing = this.getWatch(watchId);
    if (!existing) {
      await this.upsertWatch({
        id: watchId,
        workbookId: request.workbookId,
        name: `Cell Watch: ${request.question.slice(0, 32)}`,
        templateId: "custom",
        sheetName: "Sheet1",
        scheduleCron,
        composioQuery: request.question,
        matchKeyColumns: ["key"],
        columns: ["key", "answer"],
        enabled: true,
      });
    }

    const askResult = await this.handleAsk({
      workbookId: request.workbookId,
      question: request.question,
      rowValues: request.rowValues,
    });

    return {
      watchId,
      answer: askResult.answer,
      source: askResult.source,
      cached: askResult.cached,
      scheduleCron,
    };
  }

  listWatches(): WatchConfig[] {
    this.ensureSchema();
    const rows = this.sql.exec<{ config_json: string }>("SELECT config_json FROM watches");
    return rows.map((r) => JSON.parse(r.config_json) as WatchConfig);
  }

  getWatch(watchId: string): WatchConfig | null {
    this.ensureSchema();
    const rows = this.sql.exec<{ config_json: string }>(
      "SELECT config_json FROM watches WHERE id = ?",
      watchId
    );
    return rows[0] ? (JSON.parse(rows[0].config_json) as WatchConfig) : null;
  }

  async upsertWatch(input: WatchUpsertInput): Promise<WatchConfig> {
    this.ensureSchema();
    const id = input.id ?? `watch_${crypto.randomUUID().slice(0, 8)}`;
    const existing = this.getWatch(id);
    const timeZone = this.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata";
    const now = new Date();
    const nextRunMs = computeNextRunTimestamp(input.scheduleCron, now, timeZone);

    const config: WatchConfig = {
      ...existing,
      ...input,
      id,
      nextRunAt: input.enabled ? new Date(nextRunMs).toISOString() : undefined,
    };

    this.sql.exec(
      `INSERT INTO watches (id, config_json) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json`,
      id,
      JSON.stringify(config)
    );

    await this.rescheduleNextAlarm(now);
    return config;
  }

  async toggleWatch(watchId: string, enabled: boolean): Promise<WatchConfig | null> {
    const existing = this.getWatch(watchId);
    if (!existing) {
      return null;
    }
    return this.upsertWatch({
      ...existing,
      enabled,
    });
  }

  private async rescheduleNextAlarm(now: Date = new Date()): Promise<void> {
    const timeZone = this.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata";
    const enabledWatches = this.listWatches().filter((w) => w.enabled);
    if (enabledWatches.length === 0) {
      return;
    }

    const earliestMs = Math.min(
      ...enabledWatches.map((w) => computeNextRunTimestamp(w.scheduleCron, now, timeZone))
    );
    await this.alarmScheduler.setAlarm(earliestMs);
  }

  private isEmailProcessed(messageId: string): boolean {
    const rows = this.sql.exec<{ message_id: string }>(
      "SELECT message_id FROM processed_emails WHERE message_id = ?",
      messageId
    );
    return rows.length > 0;
  }

  private markEmailProcessed(messageId: string, watchId: string): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO processed_emails (message_id, watch_id, processed_at)
       VALUES (?, ?, ?)`,
      messageId,
      watchId,
      new Date().toISOString()
    );
  }

  private savePendingUpdate(update: PendingRowUpdate): void {
    this.sql.exec(
      `INSERT INTO pending_updates (id, payload_json, applied) VALUES (?, ?, 0)`,
      update.id,
      JSON.stringify(update)
    );
  }

  private saveAgentLog(entry: AgentLogEntry): void {
    this.sql.exec(
      `INSERT INTO agent_logs (id, entry_json) VALUES (?, ?)`,
      entry.id,
      JSON.stringify(entry)
    );
  }

  private getKnownRecord(matchKey: string): Record<string, string | number> | null {
    const rows = this.sql.exec<{ values_json: string }>(
      "SELECT values_json FROM known_records WHERE match_key = ?",
      matchKey
    );
    return rows[0] ? (JSON.parse(rows[0].values_json) as Record<string, string | number>) : null;
  }

  private getPriorEntityRecords(
    watchId: string,
    entityKey: string,
    excludeMatchKey: string
  ): Array<Record<string, string | number>> {
    if (!entityKey) return [];
    const rows = this.sql.exec<{ values_json: string }>(
      `SELECT values_json FROM known_records
       WHERE watch_id = ? AND entity_key = ? AND match_key != ?`,
      watchId,
      entityKey,
      excludeMatchKey
    );
    return rows.map((r) => JSON.parse(r.values_json) as Record<string, string | number>);
  }

  private upsertKnownRecord(
    matchKey: string,
    watchId: string,
    entityKey: string,
    values: Record<string, string | number>
  ): void {
    this.sql.exec(
      `INSERT INTO known_records (match_key, watch_id, entity_key, values_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(match_key) DO UPDATE SET
         values_json = excluded.values_json,
         updated_at = excluded.updated_at`,
      matchKey,
      watchId,
      entityKey,
      JSON.stringify(values),
      new Date().toISOString()
    );
  }

  private async runWatchPipeline(
    watch: WatchConfig
  ): Promise<{ logEntry: AgentLogEntry; createdUpdates: PendingRowUpdate[] }> {
    const nowIso = new Date().toISOString();
    const fetchResult = await fetchGmailMessages(watch.workbookId, watch.composioQuery, this.env);

    if (fetchResult.authExpired) {
      this.setMeta("authStatus", "auth_expired");
      this.setMeta("lastCheckedAt", nowIso);
      const logEntry: AgentLogEntry = {
        id: `log_${crypto.randomUUID().slice(0, 8)}`,
        timestamp: nowIso,
        watchName: watch.name,
        emailsScanned: 0,
        rowsAdded: 0,
        rowsUpdated: 0,
        status: "auth_expired",
        summary: fetchResult.errorMessage ?? "Gmail OAuth expired. Reconnect to resume 24/7 sync.",
      };
      this.saveAgentLog(logEntry);
      return { logEntry, createdUpdates: [] };
    }

    this.setMeta("authStatus", "connected");
    this.setMeta("lastCheckedAt", nowIso);

    const unseenMessages = fetchResult.messages.filter(
      (msg) => !this.isEmailProcessed(msg.messageId)
    );

    const createdUpdates: PendingRowUpdate[] = [];
    let rowsAdded = 0;
    let rowsUpdated = 0;
    let parseErrors = 0;
    const detailNotes: string[] = [];

    for (const email of unseenMessages) {
      try {
        const extracted = await extractRowFromEmail(email, watch, this.env);
        // Mark email processed once extraction completes cleanly (even if not relevant)
        this.markEmailProcessed(email.messageId, watch.id);

        if (!extracted) {
          continue;
        }

        const matchKey = computeMatchKey(extracted.values, watch.matchKeyColumns);
        if (!matchKey || matchKey.replace(/:/g, "").trim().length === 0) {
          continue;
        }

        const entityKey = computePrimaryEntityKey(extracted.values, watch.matchKeyColumns);
        const existingRecord = this.getKnownRecord(matchKey);
        const action: "insert" | "update" = existingRecord ? "update" : "insert";

        let confidence = extracted.confidence;
        let anomalyNote = "";

        if (watch.anomalyThresholdPct !== undefined) {
          const currentAmount = getNumericAmount(extracted.values);
          if (currentAmount !== null) {
            const baselinePool = existingRecord
              ? [existingRecord]
              : this.getPriorEntityRecords(watch.id, entityKey, matchKey);

            const baselineAmounts = baselinePool
              .map((rec) => getNumericAmount(rec))
              .filter((amt): amt is number => amt !== null && amt > 0);

            if (baselineAmounts.length > 0) {
              const baselineAvg =
                baselineAmounts.reduce((sum, a) => sum + a, 0) / baselineAmounts.length;
              const pctChange = ((currentAmount - baselineAvg) / baselineAvg) * 100;
              if (pctChange > watch.anomalyThresholdPct) {
                confidence = "needs_review";
                anomalyNote = ` [Anomaly: +${Math.round(pctChange)}% vs prior ${Math.round(
                  baselineAvg
                )}]`;
              }
            }
          }
        }

        const sourceComment = `${email.from} · "${email.subject}" (${email.receivedAt.slice(
          0,
          10
        )})${anomalyNote}`;

        const pendingUpdate: PendingRowUpdate = {
          id: `upd_${crypto.randomUUID().slice(0, 8)}`,
          watchId: watch.id,
          action,
          matchKey,
          values: extracted.values,
          sourceComment,
          confidence,
          emailMessageId: email.messageId,
          createdAt: new Date().toISOString(),
        };

        this.savePendingUpdate(pendingUpdate);
        this.upsertKnownRecord(matchKey, watch.id, entityKey, extracted.values);
        createdUpdates.push(pendingUpdate);

        if (action === "insert") {
          rowsAdded += 1;
        } else {
          rowsUpdated += 1;
          const statusVal = extracted.values.status;
          if (statusVal) {
            detailNotes.push(`1 marked ${statusVal}`);
          }
        }
      } catch (err) {
        parseErrors += 1;
        detailNotes.push(err instanceof Error ? err.message : "Extraction error");
      }
    }

    const timeZone = this.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata";
    const nextRunMs = computeNextRunTimestamp(watch.scheduleCron, new Date(), timeZone);
    const updatedWatch: WatchConfig = {
      ...watch,
      lastRunAt: nowIso,
      nextRunAt: watch.enabled ? new Date(nextRunMs).toISOString() : undefined,
    };
    this.sql.exec(
      `UPDATE watches SET config_json = ? WHERE id = ?`,
      JSON.stringify(updatedWatch),
      watch.id
    );

    const changeParts: string[] = [];
    if (rowsAdded > 0) {
      changeParts.push(`+${rowsAdded} ${rowsAdded === 1 ? "row" : "rows"}`);
    }
    if (rowsUpdated > 0) {
      changeParts.push(
        detailNotes.length > 0 ? detailNotes[0]! : `${rowsUpdated} updated`
      );
    }

    const status: AgentLogEntry["status"] =
      parseErrors > 0 && rowsAdded === 0 && rowsUpdated === 0 ? "error" : "success";

    const summary =
      changeParts.length > 0
        ? `Scanned ${fetchResult.messages.length} emails (${unseenMessages.length} new) · ${changeParts.join(
            ", "
          )}`
        : `Scanned ${fetchResult.messages.length} emails · No new changes`;

    const logEntry: AgentLogEntry = {
      id: `log_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: nowIso,
      watchName: watch.name,
      emailsScanned: unseenMessages.length,
      rowsAdded,
      rowsUpdated,
      status,
      summary: parseErrors > 0 ? `${summary} (${parseErrors} parse error)` : summary,
    };
    this.saveAgentLog(logEntry);

    return { logEntry, createdUpdates };
  }

  async runWatchNow(watchId: string): Promise<{
    logEntry: AgentLogEntry;
    pendingUpdatesCount: number;
  } | null> {
    this.ensureSchema();
    const watch = this.getWatch(watchId);
    if (!watch) {
      return null;
    }

    const { logEntry, createdUpdates } = await this.runWatchPipeline(watch);
    if (createdUpdates.length > 0) {
      await sendMorningDigest(
        watch.workbookId,
        [logEntry],
        createdUpdates,
        this.env.DIGEST_WEBHOOK_URL
      );
    }

    await this.rescheduleNextAlarm();
    return {
      logEntry,
      pendingUpdatesCount: createdUpdates.length,
    };
  }

  async handleAlarm(): Promise<{
    watchesRun: number;
    logs: AgentLogEntry[];
    pendingUpdates: PendingRowUpdate[];
  }> {
    this.ensureSchema();
    const enabledWatches = this.listWatches().filter((w) => w.enabled);
    const logs: AgentLogEntry[] = [];
    const allCreatedUpdates: PendingRowUpdate[] = [];
    let workbookId = "default-workbook";

    for (const watch of enabledWatches) {
      workbookId = watch.workbookId;
      const result = await this.runWatchPipeline(watch);
      logs.push(result.logEntry);
      allCreatedUpdates.push(...result.createdUpdates);
    }

    if (allCreatedUpdates.length > 0) {
      await sendMorningDigest(
        workbookId,
        logs,
        allCreatedUpdates,
        this.env.DIGEST_WEBHOOK_URL
      );
    }

    await this.rescheduleNextAlarm();

    return {
      watchesRun: enabledWatches.length,
      logs,
      pendingUpdates: allCreatedUpdates,
    };
  }

  async getSyncPayload(workbookId: string): Promise<SyncPayload> {
    this.ensureSchema();
    const watches = this.listWatches();

    const pendingRows = this.sql.exec<{ payload_json: string }>(
      "SELECT payload_json FROM pending_updates WHERE applied = 0 ORDER BY rowid ASC"
    );
    const pendingUpdates = pendingRows.map(
      (r) => JSON.parse(r.payload_json) as PendingRowUpdate
    );

    const logRows = this.sql.exec<{ entry_json: string }>(
      "SELECT entry_json FROM agent_logs ORDER BY rowid DESC LIMIT 50"
    );
    const agentLogs = logRows.map((r) => JSON.parse(r.entry_json) as AgentLogEntry);

    const storedAuth = this.getMeta("authStatus") as ConnectionAuthStatus | undefined;
    let authStatus: ConnectionAuthStatus =
      storedAuth ?? (isMockMode(this.env) ? "connected" : "disconnected");

    if (!storedAuth && !isMockMode(this.env) && this.env.COMPOSIO_API_KEY) {
      const auth = await getComposioAuthStatus(workbookId, this.env);
      authStatus = auth.authStatus;
      this.setMeta("authStatus", authStatus);
    }

    return {
      workbookId,
      watches,
      pendingUpdates,
      agentLogs,
      gmailConnected: authStatus === "connected",
      authStatus,
      lastCheckedAt: this.getMeta("lastCheckedAt"),
    };
  }

  ackSync(updateIds: string[]): { acknowledged: number } {
    this.ensureSchema();
    let acknowledged = 0;
    for (const id of updateIds) {
      this.sql.exec("UPDATE pending_updates SET applied = 1 WHERE id = ?", id);
      acknowledged += 1;
    }
    return { acknowledged };
  }

  async getAuthStatus(workbookId: string, callbackUrl?: string): Promise<ComposioAuthResponse> {
    this.ensureSchema();
    const auth = await getComposioAuthStatus(workbookId, this.env, callbackUrl);
    this.setMeta("authStatus", auth.authStatus);
    return auth;
  }

  setMockAuthStatus(status: ConnectionAuthStatus): void {
    this.setMeta("authStatus", status);
  }
}

export class WorkbookDurableObject extends DurableObject<WorkerEnv> {
  private readonly engine: WorkbookEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.engine = new WorkbookEngine(
      {
        exec: <T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): T[] => {
          return this.ctx.storage.sql
            .exec<Record<string, SqlStorageValue>>(query, ...bindings)
            .toArray() as unknown as T[];
        },
      },
      {
        setAlarm: (scheduledTimeMs: number) => this.ctx.storage.setAlarm(scheduledTimeMs),
        getAlarm: () => this.ctx.storage.getAlarm(),
      },
      env
    );
  }

  override async alarm(): Promise<void> {
    await this.engine.handleAlarm();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    try {
      if (url.pathname === "/ask" && method === "POST") {
        const body = (await request.json()) as AskRequest;
        return Response.json(await this.engine.handleAsk(body));
      }

      if (url.pathname === "/watch-cell" && method === "POST") {
        const body = (await request.json()) as WatchCellRequest;
        return Response.json(await this.engine.handleWatchCell(body));
      }

      if (url.pathname === "/watches" && method === "GET") {
        return Response.json({ watches: this.engine.listWatches() });
      }

      if (url.pathname === "/watches" && method === "POST") {
        const body = (await request.json()) as WatchUpsertInput;
        return Response.json(await this.engine.upsertWatch(body));
      }

      if (url.pathname.startsWith("/watches/") && url.pathname.endsWith("/run-now") && method === "POST") {
        const watchId = url.pathname.slice("/watches/".length, -"/run-now".length);
        const result = await this.engine.runWatchNow(watchId);
        if (!result) {
          return Response.json({ error: `Watch "${watchId}" not found` }, { status: 404 });
        }
        return Response.json(result);
      }

      if (url.pathname.startsWith("/watches/") && method === "PATCH") {
        const watchId = url.pathname.slice("/watches/".length);
        const body = (await request.json()) as { enabled?: boolean };
        if (typeof body.enabled !== "boolean") {
          return Response.json({ error: "enabled boolean is required" }, { status: 400 });
        }
        const updated = await this.engine.toggleWatch(watchId, body.enabled);
        if (!updated) {
          return Response.json({ error: `Watch "${watchId}" not found` }, { status: 404 });
        }
        return Response.json(updated);
      }

      if (url.pathname === "/sync" && method === "GET") {
        const workbookId = url.searchParams.get("workbookId") ?? "default-workbook";
        return Response.json(await this.engine.getSyncPayload(workbookId));
      }

      if (url.pathname === "/sync/ack" && method === "POST") {
        const body = (await request.json()) as { updateIds: string[] };
        return Response.json(this.engine.ackSync(body.updateIds));
      }

      if (url.pathname === "/auth/composio" && method === "GET") {
        const workbookId = url.searchParams.get("workbookId") ?? "default-workbook";
        const callbackUrl = url.searchParams.get("callbackUrl") ?? undefined;
        return Response.json(await this.engine.getAuthStatus(workbookId, callbackUrl));
      }

      if (url.pathname === "/alarm/trigger" && method === "POST") {
        return Response.json(await this.engine.handleAlarm());
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }
  }
}
