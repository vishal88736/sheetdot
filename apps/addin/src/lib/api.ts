import type {
  AskRequest,
  AskResponse,
  AuthSession,
  ComposioAuthResponse,
  GoogleAuthStartResponse,
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
const AUTH_SESSION_STORAGE_KEY = "sheetdot_auth_session";

export function getWorkerBaseUrl(): string {
  const viteEnv =
    typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env
      ? (import.meta as { env?: Record<string, string> }).env
      : undefined;
  return viteEnv?.VITE_WORKER_URL || DEFAULT_WORKER_URL;
}

/**
 * Resolves a deterministic workbook key:
 * - Inside an Excel document: persisted per-workbook ID scoped by Google userId
 * - On laptop browser: "main" scoped by Google userId so the same Google account
 *   always loads the same watches, PDF vault, and activity across browsers/devices
 */
export function getOrCreateWorkbookId(userId?: string): string {
  let baseId = "main";

  try {
    if (typeof Office !== "undefined" && Office.context?.document?.settings) {
      const existing = Office.context.document.settings.get(WORKBOOK_ID_STORAGE_KEY);
      if (typeof existing === "string" && existing.trim()) {
        baseId = existing;
      } else {
        baseId = `wb_${crypto.randomUUID().slice(0, 12)}`;
        Office.context.document.settings.set(WORKBOOK_ID_STORAGE_KEY, baseId);
        Office.context.document.settings.saveAsync();
      }
    }
  } catch {
    // Fallback to user-scoped main workspace outside Excel
  }

  if (userId && userId.trim()) {
    return `${userId.trim()}__${baseId}`;
  }
  return baseId;
}

export function getStoredAuthSession(): AuthSession | null {
  try {
    if (typeof Office !== "undefined" && Office.context?.document?.settings) {
      const raw = Office.context.document.settings.get(AUTH_SESSION_STORAGE_KEY);
      if (typeof raw === "string" && raw.trim()) {
        return JSON.parse(raw) as AuthSession;
      }
    }
  } catch {
    // Ignore Office settings failure
  }

  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (raw && raw.trim()) {
        return JSON.parse(raw) as AuthSession;
      }
    }
  } catch {
    // Ignore storage failure
  }

  return null;
}

export function saveAuthSession(session: AuthSession): void {
  const serialized = JSON.stringify(session);
  try {
    if (typeof Office !== "undefined" && Office.context?.document?.settings) {
      Office.context.document.settings.set(AUTH_SESSION_STORAGE_KEY, serialized);
      Office.context.document.settings.saveAsync();
    }
  } catch {
    // Ignore Office settings failure
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, serialized);
    }
  } catch {
    // Ignore storage failure
  }
}

export function clearAuthSession(): void {
  try {
    if (typeof Office !== "undefined" && Office.context?.document?.settings) {
      Office.context.document.settings.remove(AUTH_SESSION_STORAGE_KEY);
      Office.context.document.settings.saveAsync();
    }
  } catch {
    // Ignore
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

export function extractAuthSessionFromUrl(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const encoded = url.searchParams.get("sheetdot_auth");
    if (!encoded) return null;
    const session = JSON.parse(encoded) as AuthSession;
    saveAuthSession(session);
    url.searchParams.delete("sheetdot_auth");
    window.history.replaceState({}, document.title, url.toString());
    return session;
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getStoredAuthSession();
  const response = await fetch(`${getWorkerBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

/**
 * Triggers Google Sign-In + Read-Only Gmail auth:
 * - Inside Excel: uses Office.context.ui.displayDialogAsync() + messageParent()
 * - Outside Excel (laptop browser): supports multi-user mock Google sign-in or standard OAuth redirect
 */
export async function signInWithGoogle(
  baseWorkbookKey: string,
  profileHint?: { email?: string; name?: string }
): Promise<AuthSession> {
  const returnOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const params = new URLSearchParams({
    workbookId: baseWorkbookKey,
    returnOrigin,
  });
  if (profileHint?.email) params.set("email", profileHint.email);
  if (profileHint?.name) params.set("name", profileHint.name);

  const start = await requestJson<GoogleAuthStartResponse>(
    `/api/auth/google/start?${params.toString()}`,
    { method: "GET" }
  );

  if (typeof Office !== "undefined" && Office.context?.ui?.displayDialogAsync) {
    return new Promise<AuthSession>((resolve, reject) => {
      Office.context.ui.displayDialogAsync(
        start.authUrl,
        { height: 65, width: 35 },
        (asyncResult) => {
          if (asyncResult.status !== Office.AsyncResultStatus.Succeeded) {
            if (start.mockSession) {
              saveAuthSession(start.mockSession);
              resolve(start.mockSession);
              return;
            }
            reject(new Error(asyncResult.error?.message || "Could not open sign-in dialog"));
            return;
          }

          const dialog = asyncResult.value;
          dialog.addEventHandler(
            Office.EventType.DialogMessageReceived,
            (arg: { message?: string; error?: number }) => {
              dialog.close();
              if (!arg.message) {
                reject(new Error("Empty response from sign-in dialog"));
                return;
              }
              try {
                const parsed = JSON.parse(arg.message) as {
                  type?: string;
                  session?: AuthSession;
                };
                if (parsed.session) {
                  saveAuthSession(parsed.session);
                  resolve(parsed.session);
                } else {
                  reject(new Error("Malformed sign-in payload"));
                }
              } catch (err) {
                reject(err instanceof Error ? err : new Error("Invalid sign-in response"));
              }
            }
          );

          dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
            reject(new Error("Sign-in window closed before completing authentication"));
          });
        }
      );
    });
  }

  if (start.mode === "mock" && start.mockSession) {
    saveAuthSession(start.mockSession);
    return start.mockSession;
  }

  if (typeof window !== "undefined") {
    window.location.assign(start.authUrl);
  }
  throw new Error("Redirecting to Google Sign-In...");
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
