import type { AgentLogEntry, DigestSummary, PendingRowUpdate } from "@sheetdot/shared";

export interface DigestPayload extends DigestSummary {
  workbookId: string;
  logs: AgentLogEntry[];
  pendingUpdates: PendingRowUpdate[];
}

export interface DigestResult {
  sent: boolean;
  summary: DigestSummary;
}

function isDueWithin48Hours(update: PendingRowUpdate, nowMs: number): string | null {
  const statusVal = String(update.values.status ?? "").toLowerCase();
  if (statusVal === "paid" || statusVal === "confirmed") {
    return null;
  }

  const dateCandidate = update.values.due_date ?? update.values.renewal_date;
  if (!dateCandidate) return null;

  const dueMs = new Date(String(dateCandidate)).getTime();
  if (Number.isNaN(dueMs)) return null;

  const diffHours = (dueMs - nowMs) / (1000 * 60 * 60);
  if (diffHours <= 48 && diffHours >= -72) {
    const label = update.values.merchant ?? update.values.service ?? update.matchKey;
    const amount = update.values.amount ? ` (${update.values.currency ?? "INR"} ${update.values.amount})` : "";
    return `Due soon: ${label}${amount} on ${dateCandidate}`;
  }
  return null;
}

/**
 * Builds an exception-first morning summary:
 * - Escalates `auth_expired`, `error`, `needs_review` anomalies, and due-within-48h items
 * - Keeps routine `high` confidence changes quiet until the morning summary
 */
export function buildMorningDigestSummary(
  workbookId: string,
  logs: AgentLogEntry[],
  pendingUpdates: PendingRowUpdate[],
  channel: "webhook" | "stub",
  now: Date = new Date()
): DigestSummary {
  const urgentItems: string[] = [];
  const nowMs = now.getTime();

  for (const log of logs) {
    if (log.status === "auth_expired") {
      urgentItems.push(`Auth expired for "${log.watchName}": ${log.summary}`);
    } else if (log.status === "error") {
      urgentItems.push(`Error in "${log.watchName}": ${log.summary}`);
    }
  }

  let routineCount = 0;
  for (const upd of pendingUpdates) {
    if (upd.confidence === "needs_review") {
      const entity = upd.values.merchant ?? upd.values.service ?? upd.matchKey;
      urgentItems.push(`Needs review (${entity}): ${upd.sourceComment}`);
    } else {
      routineCount += 1;
    }

    const dueAlert = isDueWithin48Hours(upd, nowMs);
    if (dueAlert) {
      urgentItems.push(dueAlert);
    }
  }

  const totalAdded = logs.reduce((acc, log) => acc + log.rowsAdded, 0);
  const totalUpdated = logs.reduce((acc, log) => acc + log.rowsUpdated, 0);

  const headline =
    urgentItems.length > 0
      ? `Sheetdot Alert (${workbookId}): ${urgentItems.length} attention ${
          urgentItems.length === 1 ? "item" : "items"
        }, +${totalAdded} new, ${totalUpdated} updated.`
      : `Sheetdot Morning Digest (${workbookId}): +${totalAdded} new, ${totalUpdated} updated (all high confidence).`;

  return {
    headline,
    urgentItems,
    routineCount,
    generatedAt: now.toISOString(),
    channel,
  };
}

/**
 * Dispatches an overnight digest when urgent items exist or `forceDispatch` is enabled.
 * Quiet routine changes stay batched until morning to avoid noisy nighttime alerts.
 */
export async function sendMorningDigest(
  workbookId: string,
  logs: AgentLogEntry[],
  pendingUpdates: PendingRowUpdate[],
  webhookUrl?: string,
  options?: { forceDispatch?: boolean; now?: Date }
): Promise<DigestResult> {
  const channel: "webhook" | "stub" = webhookUrl ? "webhook" : "stub";
  const summary = buildMorningDigestSummary(
    workbookId,
    logs,
    pendingUpdates,
    channel,
    options?.now
  );

  const shouldSend = summary.urgentItems.length > 0 || options?.forceDispatch === true;
  if (!shouldSend && pendingUpdates.length === 0 && logs.every((l) => l.status === "success")) {
    return { sent: false, summary };
  }

  if (!webhookUrl) {
    console.log(`[digest:stub] ${summary.headline}`);
    return { sent: false, summary };
  }

  const payload: DigestPayload = {
    workbookId,
    ...summary,
    logs,
    pendingUpdates,
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.warn(`[digest:webhook] Failed with status ${response.status}`);
    return { sent: false, summary };
  }

  return { sent: true, summary };
}
