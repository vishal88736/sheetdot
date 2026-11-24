import { DurableObject } from "cloudflare:workers";
import {
  computeMatchKey,
  computePrimaryEntityKey,
  type AgentLogEntry,
  type AskRequest,
  type AskResponse,
  type AuthUserProfile,
  type ComposioAuthResponse,
  type ConnectionAuthStatus,
  type DigestSummary,
  type PdfPasswordHint,
  type PdfPasswordHintInput,
  type PendingRowUpdate,
  type SmsWebhookPayload,
  type SyncPayload,
  type WatchCellRequest,
  type WatchCellResponse,
  type WatchConfig,
  type WatchUpsertSchema,
} from "@sheetdot/shared";
import { z } from "zod";
import {
  fetchWatchSourceMessages,
  getComposioAuthStatus,
  isMockMode,
  type ComposioEnv,
  type GmailMessage,
} from "./composio.js";
import { computeNextRunTimestamp, normalizeScheduleInput } from "./cron.js";
import { sendMorningDigest } from "./digest.js";
import {
  answerSpreadsheetQuestion,
  extractRowFromEmail,
  type ExtractorEnv,
} from "./extractor.js";
import {
  encryptVaultPassword,
  matchesSenderPattern,
  resolveAttachmentText,
  type StoredVaultRow,
} from "./pdf-vault.js";

export interface WorkerEnv extends ComposioEnv, ExtractorEnv {
  WORKBOOK_DO: DurableObjectNamespace;
  DEFAULT_TIMEZONE?: string;
  DIGEST_WEBHOOK_URL?: string;
  VAULT_SECRET?: string;
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
 * Core workbook state & scheduling engine backed by SQLite Durable Object storage.
 * Supports per-watch deduplication, incremental cursors, encrypted PDF password vault,
 * sleep-safe circuit breakers, cell-watch re-evaluation, and batch rollback.
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
        VAULT_SECRET?: string;
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

    // Per-watch composite deduplication key (watch_id, message_id)
    const tableInfo = this.sql.exec<{ name: string; pk: number }>(
      "PRAGMA table_info(processed_emails)"
    );
    if (tableInfo.length === 0) {
      this.sql.exec(`
        CREATE TABLE processed_emails (
          watch_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          processed_at TEXT NOT NULL,
          PRIMARY KEY (watch_id, message_id)
        );
      `);
    } else {
      const pkCount = tableInfo.filter((col) => col.pk > 0).length;
      if (pkCount === 1) {
        // Safely migrate legacy single-column PK to composite (watch_id, message_id)
        this.sql.exec(`
          CREATE TABLE processed_emails_v2 (
            watch_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            processed_at TEXT NOT NULL,
            PRIMARY KEY (watch_id, message_id)
          );
        `);
        this.sql.exec(`
          INSERT OR IGNORE INTO processed_emails_v2 (watch_id, message_id, processed_at)
          SELECT watch_id, message_id, processed_at FROM processed_emails;
        `);
        this.sql.exec("DROP TABLE processed_emails;");
        this.sql.exec("ALTER TABLE processed_emails_v2 RENAME TO processed_emails;");
      }
    }

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

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS watch_cursors (
        watch_id TEXT PRIMARY KEY,
        last_synced_epoch INTEGER NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pdf_password_vault (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        sender_pattern TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        hint_description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS inbound_sms_events (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        received_at TEXT NOT NULL
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

  async handleAsk(request: AskRequest, bypassCache: boolean = false): Promise<AskResponse> {
    this.ensureSchema();
    const hash = await hashAskInput(request.question, request.rowValues);

    if (!bypassCache) {
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
        source: "cell_watch",
        sheetName: request.sheetName ?? "Sheet1",
        scheduleCron,
        composioQuery: request.question,
        matchKeyColumns: ["watch_key"],
        columns: ["watch_key", "question", "answer", "updated_at"],
        cellContext: {
          question: request.question,
          rowValues: request.rowValues,
          sheetName: request.sheetName,
          cellAddress: request.cellAddress,
        },
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
      consecutiveErrors: input.enabled ? 0 : existing?.consecutiveErrors ?? 0,
      autoPausedReason: input.enabled ? undefined : existing?.autoPausedReason,
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
      consecutiveErrors: enabled ? 0 : existing.consecutiveErrors,
      autoPausedReason: enabled ? undefined : existing.autoPausedReason,
    });
  }

  async deleteWatch(watchId: string): Promise<boolean> {
    this.ensureSchema();
    const existing = this.getWatch(watchId);
    if (!existing) return false;
    this.sql.exec("DELETE FROM watches WHERE id = ?", watchId);
    await this.rescheduleNextAlarm();
    return true;
  }

  listPdfHints(): PdfPasswordHint[] {
    this.ensureSchema();
    const rows = this.sql.exec<StoredVaultRow>(
      "SELECT id, label, sender_pattern, encrypted_password, hint_description, created_at FROM pdf_password_vault ORDER BY created_at DESC"
    );
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      senderPattern: row.sender_pattern,
      hintDescription: row.hint_description || undefined,
      hasPassword: Boolean(row.encrypted_password),
      createdAt: row.created_at,
    }));
  }

  async addPdfHint(input: PdfPasswordHintInput): Promise<PdfPasswordHint> {
    this.ensureSchema();
    const id = `hint_${crypto.randomUUID().slice(0, 8)}`;
    const encrypted = await encryptVaultPassword(input.password, this.env.VAULT_SECRET);
    const createdAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO pdf_password_vault (id, label, sender_pattern, encrypted_password, hint_description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.label,
      input.senderPattern,
      encrypted,
      input.hintDescription ?? "",
      createdAt
    );

    return {
      id,
      label: input.label,
      senderPattern: input.senderPattern,
      hintDescription: input.hintDescription,
      hasPassword: true,
      createdAt,
    };
  }

  deletePdfHint(hintId: string): boolean {
    this.ensureSchema();
    const rows = this.sql.exec<{ id: string }>(
      "SELECT id FROM pdf_password_vault WHERE id = ?",
      hintId
    );
    if (rows.length === 0) return false;
    this.sql.exec("DELETE FROM pdf_password_vault WHERE id = ?", hintId);
    return true;
  }

  ingestSmsWebhook(payload: SmsWebhookPayload): { id: string; queued: boolean } {
    this.ensureSchema();
    const id = payload.messageId ?? `sms_${crypto.randomUUID().slice(0, 8)}`;
    const receivedAt = payload.receivedAt ?? new Date().toISOString();
    this.sql.exec(
      `INSERT OR IGNORE INTO inbound_sms_events (id, sender, body, received_at)
       VALUES (?, ?, ?, ?)`,
      id,
      payload.sender,
      payload.body,
      receivedAt
    );
    return { id, queued: true };
  }

  private getMatchingVaultRows(sender: string, subject: string): StoredVaultRow[] {
    const allRows = this.sql.exec<StoredVaultRow>(
      "SELECT id, label, sender_pattern, encrypted_password, hint_description, created_at FROM pdf_password_vault"
    );
    return allRows.filter((row) => matchesSenderPattern(sender, subject, row.sender_pattern));
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

  private isEmailProcessed(watchId: string, messageId: string): boolean {
    const rows = this.sql.exec<{ message_id: string }>(
      "SELECT message_id FROM processed_emails WHERE watch_id = ? AND message_id = ?",
      watchId,
      messageId
    );
    return rows.length > 0;
  }

  private markEmailProcessed(watchId: string, messageId: string): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO processed_emails (watch_id, message_id, processed_at)
       VALUES (?, ?, ?)`,
      watchId,
      messageId,
      new Date().toISOString()
    );
  }

  private getWatchCursor(watchId: string): number | undefined {
    const rows = this.sql.exec<{ last_synced_epoch: number }>(
      "SELECT last_synced_epoch FROM watch_cursors WHERE watch_id = ?",
      watchId
    );
    return rows[0]?.last_synced_epoch;
  }

  private updateWatchCursor(watchId: string, epochSeconds: number): void {
    this.sql.exec(
      `INSERT INTO watch_cursors (watch_id, last_synced_epoch) VALUES (?, ?)
       ON CONFLICT(watch_id) DO UPDATE SET last_synced_epoch = excluded.last_synced_epoch`,
      watchId,
      epochSeconds
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

  private persistWatchState(watch: WatchConfig): void {
    this.sql.exec(
      `UPDATE watches SET config_json = ? WHERE id = ?`,
      JSON.stringify(watch),
      watch.id
    );
  }

  private recordWatchFailure(watch: WatchConfig, reason: string): WatchConfig {
    const nextErrors = (watch.consecutiveErrors ?? 0) + 1;
    const maxErrors = watch.maxConsecutiveErrors ?? 3;
    const shouldPause = nextErrors >= maxErrors;

    const updated: WatchConfig = {
      ...watch,
      consecutiveErrors: nextErrors,
      enabled: shouldPause ? false : watch.enabled,
      autoPausedReason: shouldPause
        ? `Auto-paused after ${nextErrors} consecutive errors: ${reason}`
        : watch.autoPausedReason,
      nextRunAt: shouldPause ? undefined : watch.nextRunAt,
    };
    this.persistWatchState(updated);
    return updated;
  }

  private async runCellWatchPipeline(
    watch: WatchConfig
  ): Promise<{ logEntry: AgentLogEntry; createdUpdates: PendingRowUpdate[] }> {
    const nowIso = new Date().toISOString();
    const logId = `log_${crypto.randomUUID().slice(0, 8)}`;

    if (!watch.cellContext) {
      const logEntry: AgentLogEntry = {
        id: logId,
        timestamp: nowIso,
        watchName: watch.name,
        emailsScanned: 0,
        rowsAdded: 0,
        rowsUpdated: 0,
        status: "error",
        summary: "Missing cellContext on cell_watch",
      };
      this.saveAgentLog(logEntry);
      return { logEntry, createdUpdates: [] };
    }

    const hash = await hashAskInput(watch.cellContext.question, watch.cellContext.rowValues);
    const prevCached = this.sql.exec<{ answer: string }>(
      "SELECT answer FROM answer_cache WHERE hash = ?",
      hash
    )[0]?.answer;

    const evaluated = await this.handleAsk(
      {
        workbookId: watch.workbookId,
        question: watch.cellContext.question,
        rowValues: watch.cellContext.rowValues,
      },
      true
    );

    const existing = this.getKnownRecord(watch.id);
    const createdUpdates: PendingRowUpdate[] = [];
    let rowsAdded = 0;
    let rowsUpdated = 0;

    if (!existing || prevCached !== evaluated.answer) {
      const action: "insert" | "update" = existing ? "update" : "insert";
      const values: Record<string, string | number> = {
        watch_key: watch.id,
        question: watch.cellContext.question,
        answer: evaluated.answer,
        updated_at: nowIso,
      };
      const pendingUpdate: PendingRowUpdate = {
        id: `upd_${crypto.randomUUID().slice(0, 8)}`,
        watchId: watch.id,
        batchId: logId,
        action,
        matchKey: watch.id,
        values,
        sourceComment: `=AI.WATCH refreshed via ${evaluated.source}`,
        confidence: "high",
        emailMessageId: `cell_eval_${nowIso}`,
        createdAt: nowIso,
      };
      this.savePendingUpdate(pendingUpdate);
      this.upsertKnownRecord(watch.id, watch.id, watch.id, values);
      createdUpdates.push(pendingUpdate);
      if (action === "insert") rowsAdded = 1;
      else rowsUpdated = 1;
    }

    const timeZone = this.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata";
    const nextRunMs = computeNextRunTimestamp(watch.scheduleCron, new Date(), timeZone);
    this.persistWatchState({
      ...watch,
      consecutiveErrors: 0,
      lastRunAt: nowIso,
      nextRunAt: watch.enabled ? new Date(nextRunMs).toISOString() : undefined,
    });

    const logEntry: AgentLogEntry = {
      id: logId,
      timestamp: nowIso,
      watchName: watch.name,
      emailsScanned: 1,
      rowsAdded,
      rowsUpdated,
      status: "success",
      summary:
        createdUpdates.length > 0
          ? `Cell watch refreshed: "${evaluated.answer}"`
          : `Cell watch unchanged: "${evaluated.answer}"`,
    };
    this.saveAgentLog(logEntry);
    return { logEntry, createdUpdates };
  }

  private async runWatchPipeline(
    watch: WatchConfig
  ): Promise<{ logEntry: AgentLogEntry; createdUpdates: PendingRowUpdate[] }> {
    if (watch.source === "cell_watch") {
      return this.runCellWatchPipeline(watch);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const logId = `log_${crypto.randomUUID().slice(0, 8)}`;

    let fetchMessages: GmailMessage[] = [];
    let authExpired = false;
    let errorMessage: string | undefined;

    if (watch.source === "sms_webhook") {
      const smsRows = this.sql.exec<{
        id: string;
        sender: string;
        body: string;
        received_at: string;
      }>("SELECT id, sender, body, received_at FROM inbound_sms_events ORDER BY received_at ASC");
      fetchMessages = smsRows.map((row) => ({
        messageId: row.id,
        subject: `SMS Alert from ${row.sender}`,
        from: row.sender,
        receivedAt: row.received_at,
        snippet: row.body,
        bodyText: row.body,
        sourceType: "sms_webhook",
      }));
    } else {
      const cursorEpoch = this.getWatchCursor(watch.id);
      const fetchResult = await fetchWatchSourceMessages(
        watch.workbookId,
        watch,
        this.env,
        cursorEpoch
      );
      fetchMessages = fetchResult.messages;
      authExpired = fetchResult.authExpired;
      errorMessage = fetchResult.errorMessage;
    }

    if (authExpired) {
      this.setMeta("authStatus", "auth_expired");
      this.setMeta("lastCheckedAt", nowIso);
      const updatedWatch = this.recordWatchFailure(
        watch,
        errorMessage ?? "OAuth token expired"
      );
      const logEntry: AgentLogEntry = {
        id: logId,
        timestamp: nowIso,
        watchName: watch.name,
        emailsScanned: 0,
        rowsAdded: 0,
        rowsUpdated: 0,
        status: "auth_expired",
        summary: `${errorMessage ?? "OAuth expired."}${
          updatedWatch.autoPausedReason ? " (Watch auto-paused)" : ""
        }`,
      };
      this.saveAgentLog(logEntry);
      return { logEntry, createdUpdates: [] };
    }

    this.setMeta("authStatus", "connected");
    this.setMeta("lastCheckedAt", nowIso);

    const maxPerRun = watch.maxEmailsPerRun ?? 25;
    const unseenMessages = fetchMessages
      .filter((msg) => !this.isEmailProcessed(watch.id, msg.messageId))
      .slice(0, maxPerRun);

    const createdUpdates: PendingRowUpdate[] = [];
    let rowsAdded = 0;
    let rowsUpdated = 0;
    let parseErrors = 0;
    const detailNotes: string[] = [];

    for (const email of unseenMessages) {
      try {
        let unlockedAttachmentText = email.attachmentText ?? "";
        let pdfLockNote = "";
        let pdfLocked = false;

        if (email.attachments && email.attachments.length > 0) {
          const matchingHints = this.getMatchingVaultRows(email.from, email.subject);
          const extractedParts: string[] = [];
          for (const attachment of email.attachments) {
            const pdfRes = await resolveAttachmentText(
              attachment,
              matchingHints,
              this.env.VAULT_SECRET
            );
            if (pdfRes.unlocked && pdfRes.text) {
              extractedParts.push(pdfRes.text);
            } else if (!pdfRes.unlocked) {
              pdfLocked = true;
              pdfLockNote = pdfRes.reason ?? "Locked PDF attachment";
            }
          }
          if (extractedParts.length > 0) {
            unlockedAttachmentText = [unlockedAttachmentText, ...extractedParts]
              .filter(Boolean)
              .join("\n");
          }
        }

        const enrichedEmail: GmailMessage = {
          ...email,
          attachmentText: unlockedAttachmentText || undefined,
        };

        const extracted = await extractRowFromEmail(enrichedEmail, watch, this.env);

        // If a PDF is locked and vault hint is missing, DO NOT permanently mark processed
        // so adding a hint later unlocks and extracts it on the next run!
        if (!pdfLocked) {
          this.markEmailProcessed(watch.id, email.messageId);
        }

        if (!extracted) {
          if (pdfLocked) {
            detailNotes.push(pdfLockNote);
          }
          continue;
        }

        const matchKey = computeMatchKey(
          extracted.values,
          watch.matchKeyColumns,
          watch.entityAliases
        );
        if (!matchKey || matchKey.replace(/:/g, "").trim().length === 0) {
          continue;
        }

        const entityKey = computePrimaryEntityKey(
          extracted.values,
          watch.matchKeyColumns,
          watch.entityAliases
        );
        const existingRecord = this.getKnownRecord(matchKey);
        const action: "insert" | "update" = existingRecord ? "update" : "insert";

        let confidence = pdfLocked ? "needs_review" : extracted.confidence;
        let extraNote = pdfLocked ? ` [${pdfLockNote}]` : "";

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
                extraNote += ` [Anomaly: +${Math.round(pctChange)}% vs prior ${Math.round(
                  baselineAvg
                )}]`;
              }
            }
          }
        }

        const sourceComment = `${email.from} · "${email.subject}" (${email.receivedAt.slice(
          0,
          10
        )})${extraNote}`;

        const pendingUpdate: PendingRowUpdate = {
          id: `upd_${crypto.randomUUID().slice(0, 8)}`,
          watchId: watch.id,
          batchId: logId,
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

    // Advance incremental cursor only when scan completed cleanly without parse errors
    if (parseErrors === 0 && fetchMessages.length > 0) {
      const maxEpoch = Math.max(
        ...fetchMessages
          .map((m) => Math.floor(new Date(m.receivedAt).getTime() / 1000))
          .filter((ep) => Number.isFinite(ep) && ep > 0),
        0
      );
      if (maxEpoch > 0) {
        this.updateWatchCursor(watch.id, maxEpoch);
      }
    }

    const timeZone = this.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata";
    const nextRunMs = computeNextRunTimestamp(watch.scheduleCron, now, timeZone);

    let finalWatch: WatchConfig = {
      ...watch,
      lastRunAt: nowIso,
      nextRunAt: watch.enabled ? new Date(nextRunMs).toISOString() : undefined,
    };

    const status: AgentLogEntry["status"] =
      parseErrors > 0 && rowsAdded === 0 && rowsUpdated === 0 ? "error" : "success";

    if (status === "error") {
      finalWatch = this.recordWatchFailure(finalWatch, detailNotes[0] ?? "Extraction failed");
    } else {
      finalWatch.consecutiveErrors = 0;
      finalWatch.autoPausedReason = undefined;
      this.persistWatchState(finalWatch);
    }

    const changeParts: string[] = [];
    if (rowsAdded > 0) {
      changeParts.push(`+${rowsAdded} ${rowsAdded === 1 ? "row" : "rows"}`);
    }
    if (rowsUpdated > 0) {
      changeParts.push(detailNotes[0] ?? `${rowsUpdated} updated`);
    }

    const baseSummary =
      changeParts.length > 0
        ? `Scanned ${fetchMessages.length} items (${unseenMessages.length} new) · ${changeParts.join(
            ", "
          )}`
        : `Scanned ${fetchMessages.length} items · No new changes`;

    const summary =
      parseErrors > 0
        ? `${baseSummary} (${parseErrors} error${finalWatch.autoPausedReason ? "; auto-paused" : ""})`
        : detailNotes.some((n) => n.includes("Locked PDF"))
          ? `${baseSummary} · ${detailNotes.find((n) => n.includes("Locked PDF"))}`
          : baseSummary;

    const logEntry: AgentLogEntry = {
      id: logId,
      timestamp: nowIso,
      watchName: watch.name,
      emailsScanned: unseenMessages.length,
      rowsAdded,
      rowsUpdated,
      status,
      summary,
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
    const digestRes = await sendMorningDigest(
      watch.workbookId,
      [logEntry],
      createdUpdates,
      this.env.DIGEST_WEBHOOK_URL,
      { forceDispatch: createdUpdates.length > 0 }
    );
    this.setMeta("latestDigest", JSON.stringify(digestRes.summary));

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
    digest: DigestSummary;
  }> {
    this.ensureSchema();
    const enabledWatches = this.listWatches().filter((w) => w.enabled);
    const logs: AgentLogEntry[] = [];
    const allCreatedUpdates: PendingRowUpdate[] = [];
    const workbookId = enabledWatches[0]?.workbookId ?? "default-workbook";

    // Run watches with isolated error boundaries in batches of 4
    const batchSize = 4;
    for (let i = 0; i < enabledWatches.length; i += batchSize) {
      const slice = enabledWatches.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        slice.map((watch) => this.runWatchPipeline(watch))
      );

      results.forEach((settled, idx) => {
        const watch = slice[idx]!;
        if (settled.status === "fulfilled") {
          logs.push(settled.value.logEntry);
          allCreatedUpdates.push(...settled.value.createdUpdates);
        } else {
          const errMsg =
            settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
          this.recordWatchFailure(watch, errMsg);
          const errLog: AgentLogEntry = {
            id: `log_${crypto.randomUUID().slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            watchName: watch.name,
            emailsScanned: 0,
            rowsAdded: 0,
            rowsUpdated: 0,
            status: "error",
            summary: errMsg,
          };
          this.saveAgentLog(errLog);
          logs.push(errLog);
        }
      });
    }

    const digestRes = await sendMorningDigest(
      workbookId,
      logs,
      allCreatedUpdates,
      this.env.DIGEST_WEBHOOK_URL,
      { forceDispatch: allCreatedUpdates.length > 0 }
    );
    this.setMeta("latestDigest", JSON.stringify(digestRes.summary));

    await this.rescheduleNextAlarm();

    return {
      watchesRun: enabledWatches.length,
      logs,
      pendingUpdates: allCreatedUpdates,
      digest: digestRes.summary,
    };
  }

  revertLogBatch(logId: string): { revertedUpdates: number; foundLog: boolean } {
    this.ensureSchema();
    const logRows = this.sql.exec<{ id: string; entry_json: string }>(
      "SELECT id, entry_json FROM agent_logs WHERE id = ?",
      logId
    );
    const logRow = logRows[0];
    if (!logRow) {
      return { revertedUpdates: 0, foundLog: false };
    }

    const pendingRows = this.sql.exec<{ id: string; payload_json: string }>(
      "SELECT id, payload_json FROM pending_updates WHERE applied = 0"
    );

    let revertedUpdates = 0;
    for (const row of pendingRows) {
      const parsed = JSON.parse(row.payload_json) as PendingRowUpdate;
      if (parsed.batchId === logId) {
        this.sql.exec("DELETE FROM pending_updates WHERE id = ?", row.id);
        this.sql.exec(
          "DELETE FROM processed_emails WHERE watch_id = ? AND message_id = ?",
          parsed.watchId,
          parsed.emailMessageId
        );
        revertedUpdates += 1;
      }
    }

    const parsedLog = JSON.parse(logRow.entry_json) as AgentLogEntry;
    const updatedLog: AgentLogEntry = {
      ...parsedLog,
      reverted: true,
      summary: `${parsedLog.summary} [Reverted ${revertedUpdates} queued update(s)]`,
    };
    this.sql.exec(
      "UPDATE agent_logs SET entry_json = ? WHERE id = ?",
      JSON.stringify(updatedLog),
      logId
    );

    return { revertedUpdates, foundLog: true };
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

    const rawDigest = this.getMeta("latestDigest");
    const latestDigest = rawDigest ? (JSON.parse(rawDigest) as DigestSummary) : undefined;
    const rawUserProfile = this.getMeta("userProfile");
    const userProfile = rawUserProfile ? (JSON.parse(rawUserProfile) as AuthUserProfile) : undefined;

    return {
      workbookId,
      watches,
      pendingUpdates,
      agentLogs,
      gmailConnected: authStatus === "connected",
      authStatus,
      lastCheckedAt: this.getMeta("lastCheckedAt"),
      latestDigest,
      pdfHints: this.listPdfHints(),
      userProfile,
    };
  }

  setUserProfile(profile: AuthUserProfile): void {
    this.setMeta("userProfile", JSON.stringify(profile));
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

      if (url.pathname.startsWith("/watches/") && method === "DELETE") {
        const watchId = url.pathname.slice("/watches/".length);
        const deleted = await this.engine.deleteWatch(watchId);
        return Response.json({ deleted });
      }

      if (url.pathname === "/vault/pdf-hints" && method === "GET") {
        return Response.json({ hints: this.engine.listPdfHints() });
      }

      if (url.pathname === "/vault/pdf-hints" && method === "POST") {
        const body = (await request.json()) as PdfPasswordHintInput;
        return Response.json(await this.engine.addPdfHint(body));
      }

      if (url.pathname.startsWith("/vault/pdf-hints/") && method === "DELETE") {
        const hintId = url.pathname.slice("/vault/pdf-hints/".length);
        return Response.json({ deleted: this.engine.deletePdfHint(hintId) });
      }

      if (url.pathname === "/webhooks/sms" && method === "POST") {
        const body = (await request.json()) as SmsWebhookPayload;
        return Response.json(this.engine.ingestSmsWebhook(body));
      }

      if (url.pathname.startsWith("/logs/") && url.pathname.endsWith("/revert") && method === "POST") {
        const logId = url.pathname.slice("/logs/".length, -"/revert".length);
        const res = this.engine.revertLogBatch(logId);
        if (!res.foundLog) {
          return Response.json({ error: `Log "${logId}" not found` }, { status: 404 });
        }
        return Response.json(res);
      }

      if (url.pathname === "/sync" && method === "GET") {
        const workbookId = url.searchParams.get("workbookId") ?? "default-workbook";
        return Response.json(await this.engine.getSyncPayload(workbookId));
      }

      if (url.pathname === "/auth/profile" && method === "POST") {
        const body = (await request.json()) as AuthUserProfile;
        this.engine.setUserProfile(body);
        return Response.json({ ok: true });
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
