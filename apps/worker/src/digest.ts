import type { AgentLogEntry, PendingRowUpdate } from "@sheetdot/shared";

export interface DigestPayload {
  workbookId: string;
  generatedAt: string;
  headline: string;
  logs: AgentLogEntry[];
  pendingUpdates: PendingRowUpdate[];
}

export interface DigestResult {
  sent: boolean;
  channel: "webhook" | "stub";
  headline: string;
}

/**
 * Sends a morning summary digest when overnight watches detect changes.
 * Uses DIGEST_WEBHOOK_URL (WhatsApp/email bridge) when configured; otherwise logs a clean stub.
 */
export async function sendMorningDigest(
  workbookId: string,
  logs: AgentLogEntry[],
  pendingUpdates: PendingRowUpdate[],
  webhookUrl?: string
): Promise<DigestResult> {
  const totalAdded = logs.reduce((acc, log) => acc + log.rowsAdded, 0);
  const totalUpdated = logs.reduce((acc, log) => acc + log.rowsUpdated, 0);
  const reviewCount = pendingUpdates.filter((u) => u.confidence === "needs_review").length;

  const headline = `Sheetdot Morning Digest (${workbookId}): +${totalAdded} new, ${totalUpdated} updated${
    reviewCount > 0 ? `, ${reviewCount} needing review` : ""
  }.`;

  if (!webhookUrl) {
    console.log(`[digest:stub] ${headline}`);
    return {
      sent: false,
      channel: "stub",
      headline,
    };
  }

  const payload: DigestPayload = {
    workbookId,
    generatedAt: new Date().toISOString(),
    headline,
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
    return {
      sent: false,
      channel: "webhook",
      headline,
    };
  }

  return {
    sent: true,
    channel: "webhook",
    headline,
  };
}
