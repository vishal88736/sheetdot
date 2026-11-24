import type {
  AskRequest,
  AskResponse,
  ComposioAuthResponse,
  PdfPasswordHint,
  PdfPasswordHintInput,
  SyncAckRequest,
  SyncPayload,
  WatchCellRequest,
  WatchCellResponse,
  WatchConfig,
} from "@sheetdot/shared";

const DEFAULT_WORKER_URL = "http://localhost:8787";
const WORKBOOK_ID_STORAGE_KEY = "sheetdot_workbook_id";

export function getWorkerBaseUrl(): string {
  const viteEnv =
    typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env
      ? (import.meta as { env?: Record<string, string> }).env
      : undefined;
  return viteEnv?.VITE_WORKER_URL || DEFAULT_WORKER_URL;
}

export function getOrCreateWorkbookId(): string {
  try {
    if (typeof Office !== "undefined" && Office.context?.document?.settings) {
      const existing = Office.context.document.settings.get(WORKBOOK_ID_STORAGE_KEY);
      if (typeof existing === "string" && existing.trim()) {
        return existing;
      }
      const created = `wb_${crypto.randomUUID().slice(0, 12)}`;
      Office.context.document.settings.set(WORKBOOK_ID_STORAGE_KEY, created);
      Office.context.document.settings.saveAsync();
      return created;
    }
  } catch {
    // Fallback outside Office runtime
  }

  try {
    if (typeof localStorage !== "undefined") {
      const existing = localStorage.getItem(WORKBOOK_ID_STORAGE_KEY);
      if (existing && existing.trim()) {
        return existing;
      }
      const created = `wb_${crypto.randomUUID().slice(0, 12)}`;
      localStorage.setItem(WORKBOOK_ID_STORAGE_KEY, created);
      return created;
    }
  } catch {
    // Ignore storage error
  }

  return "default-workbook";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getWorkerBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export function fetchSyncState(workbookId: string): Promise<SyncPayload> {
  return requestJson<SyncPayload>(`/api/sync?workbookId=${encodeURIComponent(workbookId)}`, {
    method: "GET",
  });
}

export function acknowledgeSync(payload: SyncAckRequest): Promise<{ acknowledged: number }> {
  return requestJson<{ acknowledged: number }>("/api/sync/ack", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function upsertWatch(
  watch: Omit<WatchConfig, "id"> & { id?: string }
): Promise<WatchConfig> {
  return requestJson<WatchConfig>("/api/watches", {
    method: "POST",
    body: JSON.stringify(watch),
  });
}

export function toggleWatchEnabled(
  workbookId: string,
  watchId: string,
  enabled: boolean
): Promise<WatchConfig> {
  return requestJson<WatchConfig>(`/api/watches/${encodeURIComponent(watchId)}`, {
    method: "PATCH",
    body: JSON.stringify({ workbookId, enabled }),
  });
}

export function deleteWatch(workbookId: string, watchId: string): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/watches/${encodeURIComponent(watchId)}?workbookId=${encodeURIComponent(workbookId)}`,
    { method: "DELETE" }
  );
}

export function runWatchNow(
  workbookId: string,
  watchId: string
): Promise<{ logEntry: unknown; pendingUpdatesCount: number }> {
  return requestJson<{ logEntry: unknown; pendingUpdatesCount: number }>(
    `/api/watches/${encodeURIComponent(watchId)}/run-now`,
    {
      method: "POST",
      body: JSON.stringify({ workbookId }),
    }
  );
}

export function triggerAllWatchesAlarm(workbookId: string): Promise<{
  watchesRun: number;
  pendingUpdates: unknown[];
}> {
  return requestJson<{ watchesRun: number; pendingUpdates: unknown[] }>(
    `/api/alarm/trigger?workbookId=${encodeURIComponent(workbookId)}`,
    { method: "POST" }
  );
}

export function addPdfHint(
  workbookId: string,
  hint: PdfPasswordHintInput
): Promise<PdfPasswordHint> {
  return requestJson<PdfPasswordHint>("/api/vault/pdf-hints", {
    method: "POST",
    body: JSON.stringify({ workbookId, ...hint }),
  });
}

export function deletePdfHint(
  workbookId: string,
  hintId: string
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/vault/pdf-hints/${encodeURIComponent(hintId)}?workbookId=${encodeURIComponent(workbookId)}`,
    { method: "DELETE" }
  );
}

export function revertAgentLog(
  workbookId: string,
  logId: string
): Promise<{ revertedUpdates: number; foundLog: boolean }> {
  return requestJson<{ revertedUpdates: number; foundLog: boolean }>(
    `/api/logs/${encodeURIComponent(logId)}/revert?workbookId=${encodeURIComponent(workbookId)}`,
    { method: "POST" }
  );
}

export function getComposioAuth(workbookId: string): Promise<ComposioAuthResponse> {
  return requestJson<ComposioAuthResponse>(
    `/api/auth/composio?workbookId=${encodeURIComponent(workbookId)}`,
    { method: "GET" }
  );
}

export function askCellQuestion(payload: AskRequest): Promise<AskResponse> {
  return requestJson<AskResponse>("/api/ask", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function registerWatchCell(payload: WatchCellRequest): Promise<WatchCellResponse> {
  return requestJson<WatchCellResponse>("/api/watch-cell", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
