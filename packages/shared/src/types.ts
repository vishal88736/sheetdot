import { z } from "zod";

export type ConfidenceLevel = "high" | "needs_review";

export type TemplateId = "bills" | "subscriptions" | "travel" | "custom";

export interface WatchConfig {
  id: string;
  workbookId: string;
  name: string;                    // e.g., "Monthly Bills"
  templateId: "bills" | "subscriptions" | "travel" | "custom";
  sheetName: string;               // Target Excel worksheet name
  scheduleCron: string;            // e.g., "0 8 * * *" (daily 8am)
  composioQuery: string;           // e.g., 'bill OR invoice OR receipt'
  matchKeyColumns: string[];       // e.g., ["merchant", "billing_month"]
  columns: string[];               // Ordered table headers
  anomalyThresholdPct?: number;    // e.g., 20 (flag >20% spike as needs_review)
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface PendingRowUpdate {
  id: string;
  watchId: string;
  action: "insert" | "update";
  matchKey: string;                // Deterministic key, e.g. "airtel::2026-11"
  values: Record<string, string | number>;
  sourceComment: string;           // Provenance written to Excel cell comment
  confidence: ConfidenceLevel;     // "high" -> yellow (#FEF08A), "needs_review" -> orange (#FED7AA)
  emailMessageId: string;          // Used for strict deduplication
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
}

export interface WatchCellResponse {
  watchId: string;
  answer: string;
  source: string;
  cached: boolean;
  scheduleCron: string;
}

export type ConnectionAuthStatus = "connected" | "disconnected" | "auth_expired";

export interface SyncPayload {
  workbookId: string;
  watches: WatchConfig[];
  pendingUpdates: PendingRowUpdate[];
  agentLogs: AgentLogEntry[];
  gmailConnected: boolean;
  authStatus: ConnectionAuthStatus;
  lastCheckedAt?: string;
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

export const WatchConfigSchema = z.object({
  id: z.string().min(1),
  workbookId: z.string().min(1),
  name: z.string().min(1),
  templateId: TemplateIdSchema,
  sheetName: z.string().min(1),
  scheduleCron: z.string().min(1),
  composioQuery: z.string().min(1),
  matchKeyColumns: z.array(z.string().min(1)).min(1),
  columns: z.array(z.string().min(1)).min(1),
  anomalyThresholdPct: z.number().min(0).max(1000).optional(),
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
});

export const AskRequestSchema = z.object({
  workbookId: z.string().min(1).default("default-workbook"),
  question: z.string().min(1),
  rowValues: z.union([
    z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ]),
});

export const WatchCellRequestSchema = AskRequestSchema.extend({
  schedule: z.string().min(1).default("0 8 * * *"),
});

export const SyncAckRequestSchema = z.object({
  workbookId: z.string().min(1),
  updateIds: z.array(z.string().min(1)),
});

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: "#FEF08A",
  needs_review: "#FED7AA",
};

export const SHEETDOT_ID_COLUMN = "_sheetdot_id";
export const AGENT_LOG_SHEET_NAME = "_AgentLog";

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

export function computeMatchKey(
  values: Record<string, string | number | boolean | null | undefined>,
  matchKeyColumns: string[]
): string {
  const parts = matchKeyColumns.map((column) => {
    const direct = values[column];
    if (direct !== undefined) {
      return normalizeMatchKeyPart(direct);
    }
    const lowerCol = column.toLowerCase();
    const matchedEntry = Object.entries(values).find(([k]) => k.toLowerCase() === lowerCol);
    return normalizeMatchKeyPart(matchedEntry?.[1]);
  });
  return parts.join("::");
}

export function computePrimaryEntityKey(
  values: Record<string, string | number | boolean | null | undefined>,
  matchKeyColumns: string[]
): string {
  const firstColumn = matchKeyColumns[0];
  if (!firstColumn) {
    return "";
  }
  return computeMatchKey(values, [firstColumn]);
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
