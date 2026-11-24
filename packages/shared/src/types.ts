import { z } from "zod";

export type ConfidenceLevel = "high" | "needs_review";

export type TemplateId = "bills" | "subscriptions" | "travel" | "custom";

export type WatchSourceType = "gmail" | "calendar" | "github" | "sms_webhook" | "cell_watch";

export interface WatchCellContext {
  question: string;
  rowValues: Array<Array<string | number | boolean | null>> | Record<string, string | number | boolean | null>;
  sheetName?: string;
  cellAddress?: string;
}

export interface WatchConfig {
  id: string;
  workbookId: string;
  name: string;                    // e.g., "Monthly Bills"
  templateId: "bills" | "subscriptions" | "travel" | "custom";
  source?: WatchSourceType;        // Defaults to "gmail"
  sheetName: string;               // Target Excel worksheet name
  scheduleCron: string;            // e.g., "0 8 * * *" (daily 8am)
  composioQuery: string;           // e.g., 'bill OR invoice OR receipt'
  matchKeyColumns: string[];       // e.g., ["merchant", "billing_month"]
  columns: string[];               // Ordered table headers
  anomalyThresholdPct?: number;    // e.g., 20 (flag >20% spike as needs_review)
  maxEmailsPerRun?: number;        // Circuit breaker cap per run (default 25)
  maxConsecutiveErrors?: number;   // Auto-pause threshold (default 3)
  consecutiveErrors?: number;
  autoPausedReason?: string;
  entityAliases?: Record<string, string>; // Optional vendor alias map -> canonical name
  cellContext?: WatchCellContext;  // Used when source === "cell_watch"
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface PendingRowUpdate {
  id: string;
  watchId: string;
  batchId?: string;                // Links update to its AgentLogEntry for rollback
  action: "insert" | "update";
  matchKey: string;                // Deterministic key, e.g. "airtel::2026-11"
  values: Record<string, string | number>;
  sourceComment: string;           // Provenance written to Excel cell comment
  confidence: ConfidenceLevel;     // "high" -> yellow (#FEF08A), "needs_review" -> orange (#FED7AA)
  emailMessageId: string;          // Used for strict per-watch deduplication
  createdAt: string;
}

export interface AgentLogEntry {
  id: string;
  timestamp: string;
  watchName: string;
  emailsScanned: number;
  rowsAdded: number;
  rowsUpdated: number;
  status: "success" | "auth_expired" | "error";
  summary: string;
  reverted?: boolean;
}

export interface AskRequest {
  workbookId: string;
  question: string;
  rowValues: Array<Array<string | number | boolean | null>> | Record<string, string | number | boolean | null>;
}

export interface AskResponse {
  answer: string;
  source: string;
  cached: boolean;
}

export interface WatchCellRequest {
  workbookId: string;
  question: string;
  rowValues: Array<Array<string | number | boolean | null>> | Record<string, string | number | boolean | null>;
  schedule: string;
  sheetName?: string;
  cellAddress?: string;
}

export interface WatchCellResponse {
  watchId: string;
  answer: string;
  source: string;
  cached: boolean;
  scheduleCron: string;
}

export type ConnectionAuthStatus = "connected" | "disconnected" | "auth_expired";

export interface PdfPasswordHint {
  id: string;
  label: string;
  senderPattern: string;
  hintDescription?: string;
  hasPassword: boolean;
  createdAt: string;
}

export interface PdfPasswordHintInput {
  label: string;
  senderPattern: string;
  password: string;
  hintDescription?: string;
}

export interface DigestSummary {
  headline: string;
  urgentItems: string[];
  routineCount: number;
  generatedAt: string;
  channel: "webhook" | "stub";
}

export interface SmsWebhookPayload {
  workbookId: string;
  sender: string;
  body: string;
  receivedAt?: string;
  messageId?: string;
}

export interface SyncPayload {
  workbookId: string;
  watches: WatchConfig[];
  pendingUpdates: PendingRowUpdate[];
  agentLogs: AgentLogEntry[];
  gmailConnected: boolean;
  authStatus: ConnectionAuthStatus;
  lastCheckedAt?: string;
  latestDigest?: DigestSummary;
  pdfHints?: PdfPasswordHint[];
}

export interface SyncAckRequest {
  workbookId: string;
  updateIds: string[];
}

export interface ComposioAuthResponse {
  connected: boolean;
  authStatus: ConnectionAuthStatus;
  redirectUrl?: string;
  mode: "mock" | "composio";
  message: string;
}

export interface WatchTemplate {
  id: Exclude<TemplateId, "custom">;
  title: string;
  description: string;
  name: string;
  sheetName: string;
  scheduleCron: string;
  composioQuery: string;
  matchKeyColumns: string[];
  columns: string[];
  anomalyThresholdPct: number;
}

export const ConfidenceLevelSchema = z.enum(["high", "needs_review"]);
export const TemplateIdSchema = z.enum(["bills", "subscriptions", "travel", "custom"]);
export const WatchSourceTypeSchema = z.enum([
  "gmail",
  "calendar",
  "github",
  "sms_webhook",
  "cell_watch",
]);

const CellScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const RowValuesSchema = z.union([
  z.array(z.array(CellScalarSchema)),
  z.record(z.string(), CellScalarSchema),
]);

export const WatchCellContextSchema = z.object({
  question: z.string().min(1),
  rowValues: RowValuesSchema,
  sheetName: z.string().optional(),
  cellAddress: z.string().optional(),
});

export const WatchConfigSchema = z.object({
  id: z.string().min(1),
  workbookId: z.string().min(1),
  name: z.string().min(1),
  templateId: TemplateIdSchema,
  source: WatchSourceTypeSchema.optional(),
  sheetName: z.string().min(1),
  scheduleCron: z.string().min(1),
  composioQuery: z.string().min(1),
  matchKeyColumns: z.array(z.string().min(1)).min(1),
  columns: z.array(z.string().min(1)).min(1),
  anomalyThresholdPct: z.number().min(0).max(1000).optional(),
  maxEmailsPerRun: z.number().int().min(1).max(200).optional(),
  maxConsecutiveErrors: z.number().int().min(1).max(20).optional(),
  consecutiveErrors: z.number().int().min(0).optional(),
  autoPausedReason: z.string().optional(),
  entityAliases: z.record(z.string(), z.string()).optional(),
  cellContext: WatchCellContextSchema.optional(),
  enabled: z.boolean(),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
});

export const WatchUpsertSchema = WatchConfigSchema.omit({ id: true }).extend({
  id: z.string().min(1).optional(),
});

export const PendingRowUpdateSchema = z.object({
  id: z.string().min(1),
  watchId: z.string().min(1),
  batchId: z.string().optional(),
  action: z.enum(["insert", "update"]),
  matchKey: z.string().min(1),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
  sourceComment: z.string().min(1),
  confidence: ConfidenceLevelSchema,
  emailMessageId: z.string().min(1),
  createdAt: z.string().min(1),
});

export const AgentLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  watchName: z.string().min(1),
  emailsScanned: z.number().int().min(0),
  rowsAdded: z.number().int().min(0),
  rowsUpdated: z.number().int().min(0),
  status: z.enum(["success", "auth_expired", "error"]),
  summary: z.string(),
  reverted: z.boolean().optional(),
});

export const AskRequestSchema = z.object({
  workbookId: z.string().min(1).default("default-workbook"),
  question: z.string().min(1),
  rowValues: RowValuesSchema,
});

export const WatchCellRequestSchema = AskRequestSchema.extend({
  schedule: z.string().min(1).default("0 8 * * *"),
  sheetName: z.string().optional(),
  cellAddress: z.string().optional(),
});

export const SyncAckRequestSchema = z.object({
  workbookId: z.string().min(1),
  updateIds: z.array(z.string().min(1)),
});

export const PdfPasswordHintInputSchema = z.object({
  label: z.string().min(1),
  senderPattern: z.string().min(1),
  password: z.string().min(1),
  hintDescription: z.string().optional(),
});

export const SmsWebhookPayloadSchema = z.object({
  workbookId: z.string().min(1).default("default-workbook"),
  sender: z.string().min(1),
  body: z.string().min(1),
  receivedAt: z.string().optional(),
  messageId: z.string().optional(),
});

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: "#FEF08A",
  needs_review: "#FED7AA",
};

export const SHEETDOT_ID_COLUMN = "_sheetdot_id";
export const AGENT_LOG_SHEET_NAME = "_AgentLog";

const DEFAULT_ENTITY_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:bharti\s+)?airtel(?:\s+(?:black|fiber|postpaid|payments?))?\b/i, "airtel"],
  [/\bbescom(?:\s+electricity)?\b/i, "bescom"],
  [/\bhdfc(?:\s+bank)?(?:\s+regalia)?\s*(?:credit\s*card|card)?\b/i, "hdfc credit card"],
  [/\bsbi\s*(?:card|credit\s*card)?\b/i, "sbi card"],
  [/\byoutube\s*premium(?:\s*family)?\b/i, "youtube premium"],
  [/\bnotion(?:\s+plus)?\b/i, "notion"],
];

export function normalizeMatchKeyPart(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/::+/g, ":");
}

export function normalizeEntityAlias(
  value: string | number | boolean | null | undefined,
  customAliases?: Record<string, string>
): string {
  const normalized = normalizeMatchKeyPart(value);
  if (!normalized) return "";

  if (customAliases) {
    for (const [alias, canonical] of Object.entries(customAliases)) {
      if (normalized === alias.trim().toLowerCase()) {
        return normalizeMatchKeyPart(canonical);
      }
    }
  }

  for (const [pattern, canonical] of DEFAULT_ENTITY_ALIASES) {
    if (pattern.test(normalized)) {
      return canonical;
    }
  }

  return normalized;
}

export function computeMatchKey(
  values: Record<string, string | number | boolean | null | undefined>,
  matchKeyColumns: string[],
  customAliases?: Record<string, string>
): string {
  const parts = matchKeyColumns.map((column, index) => {
    let rawValue = values[column];
    if (rawValue === undefined) {
      const lowerCol = column.toLowerCase();
      const matchedEntry = Object.entries(values).find(([k]) => k.toLowerCase() === lowerCol);
      rawValue = matchedEntry?.[1];
    }
    return index === 0
      ? normalizeEntityAlias(rawValue, customAliases)
      : normalizeMatchKeyPart(rawValue);
  });
  return parts.join("::");
}

export function computePrimaryEntityKey(
  values: Record<string, string | number | boolean | null | undefined>,
  matchKeyColumns: string[],
  customAliases?: Record<string, string>
): string {
  const firstColumn = matchKeyColumns[0];
  if (!firstColumn) {
    return "";
  }
  return computeMatchKey(values, [firstColumn], customAliases);
}

export function formatCronBadge(cron: string): string {
  const trimmed = cron.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return trimmed;
  }
  const [minuteStr, hourStr, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    if (hourStr === "*" && minuteStr?.startsWith("*/")) {
      return `Every ${minuteStr.slice(2)}m`;
    }
    const minute = Number(minuteStr);
    const hour = Number(hourStr);
    if (Number.isInteger(minute) && Number.isInteger(hour) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
      const displayMin = String(minute).padStart(2, "0");
      return `Daily ${displayHour}:${displayMin} ${period}`;
    }
  }
  return trimmed;
}
