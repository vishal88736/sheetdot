import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Calendar,
  Check,
  Clock,
  Lock,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  CONNECTOR_PRESETS,
  createWatchFromTemplate,
  formatCronBadge,
  type AgentLogEntry,
  type AuthSession,
  type ConnectionAuthStatus,
  type DigestSummary,
  type PdfPasswordHint,
  type PendingRowUpdate,
  type WatchConfig,
  type WatchSourceType,
  type WatchTemplate,
} from "@sheetdot/shared";
import {
  addPdfHint,
  clearAuthSession,
  deletePdfHint,
  deleteWatch,
  extractAuthSessionFromUrl,
  fetchSyncState,
  getOrCreateWorkbookId,
  getStoredAuthSession,
  revertAgentLog,
  runWatchNow,
  signInWithGoogle,
  toggleWatchEnabled,
  triggerAllWatchesAlarm,
  upsertWatch,
} from "../lib/api.js";
import { ensureTemplateTable, syncWorkbookWithExcel } from "../sync/excelSync.js";
import { ConnectionBanner } from "./components/ConnectionBanner.js";
import { LogList } from "./components/LogList.js";
import {
  DetailPinkMascot,
  PeekingGreenMascot,
  WavingPurpleMascot,
} from "./components/Mascots.js";
import { TemplatePicker } from "./components/TemplatePicker.js";
import { WatchCard } from "./components/WatchCard.js";

type ActiveTab = "watches" | "templates" | "activity";
type ConnectorChoice = Exclude<WatchSourceType, "cell_watch">;

function GoogleMark() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.54-5.17 3.54-8.89Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.88-3.02c-1.08.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.93H1.3v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.31 14.29A7.2 7.2 0 0 1 4.93 12c0-.79.14-1.56.38-2.29V6.61H1.3A12 12 0 0 0 0 12c0 1.93.46 3.76 1.3 5.39l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.78c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.61l4.01 3.1C6.25 6.88 8.89 4.78 12 4.78Z"
      />
    </svg>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(
    () => extractAuthSessionFromUrl() ?? getStoredAuthSession()
  );
  const workbookId = getOrCreateWorkbookId(authSession?.user.id);

  const [activeTab, setActiveTab] = useState<ActiveTab>("watches");
  const [watches, setWatches] = useState<WatchConfig[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<PendingRowUpdate[]>([]);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [latestDigest, setLatestDigest] = useState<DigestSummary | undefined>(undefined);
  const [pdfHints, setPdfHints] = useState<PdfPasswordHint[]>([]);
  const [authStatus, setAuthStatus] = useState<ConnectionAuthStatus>("connected");
  const [lastCheckedAt, setLastCheckedAt] = useState<string | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [runningWatchId, setRunningWatchId] = useState<string | null>(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Google custom mock account chooser input
  const [customEmail, setCustomEmail] = useState("");
  const [customName, setCustomName] = useState("");
  const [showCustomAccountForm, setShowCustomAccountForm] = useState(false);

  // Watch detail drawer/modal
  const [selectedWatch, setSelectedWatch] = useState<WatchConfig | null>(null);

  // New Custom Watch modal
  const [showNewWatchModal, setShowNewWatchModal] = useState(false);
  const [newSource, setNewSource] = useState<ConnectorChoice>("gmail");
  const [newName, setNewName] = useState("Monthly Bills");
  const [newSheetName, setNewSheetName] = useState(CONNECTOR_PRESETS.gmail.defaultSheetName);
  const [newQuery, setNewQuery] = useState(CONNECTOR_PRESETS.gmail.defaultQuery);
  const [newCron, setNewCron] = useState("0 8 * * *");
  const [newMatchKeys, setNewMatchKeys] = useState(
    CONNECTOR_PRESETS.gmail.defaultMatchKeys.join(", ")
  );
  const [newColumns, setNewColumns] = useState(CONNECTOR_PRESETS.gmail.defaultColumns.join(", "));
  const [newAnomalyPct, setNewAnomalyPct] = useState(20);
  const [newMaxEmails, setNewMaxEmails] = useState(25);

  // PDF Vault modal
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [hintLabel, setHintLabel] = useState("");
  const [hintPattern, setHintPattern] = useState("");
  const [hintPassword, setHintPassword] = useState("");

  const applySyncState = useCallback(
    (sync: Awaited<ReturnType<typeof fetchSyncState>>, inExcel: boolean) => {
      setWatches(sync.watches);
      setPendingUpdates(inExcel ? [] : sync.pendingUpdates);
      setLogs(sync.agentLogs);
      setAuthStatus(sync.authStatus);
      setLastCheckedAt(sync.lastCheckedAt);
      setLatestDigest(sync.latestDigest);
      setPdfHints(sync.pdfHints ?? []);
      setPendingCount(inExcel ? 0 : sync.pendingUpdates.length);
      setSelectedWatch((prev) =>
        prev ? sync.watches.find((w) => w.id === prev.id) ?? null : null
      );
    },
    []
  );

  const refreshState = useCallback(async () => {
    if (!authSession) return;
    try {
      const sync = await fetchSyncState(workbookId);
      applySyncState(sync, false);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Service unavailable");
    }
  }, [applySyncState, authSession, workbookId]);

  const handleSyncNow = useCallback(async () => {
    if (!authSession) return;
    setIsSyncing(true);
    setStatusNote(null);
    try {
      const result = await syncWorkbookWithExcel(workbookId);
      applySyncState(result.syncPayload, result.inExcelHost);

      if (result.inExcelHost) {
        setStatusNote(
          result.rowsAdded + result.rowsUpdated > 0
            ? `Merged +${result.rowsAdded} new, ${result.rowsUpdated} updated`
            : "Workbook is up to date"
        );
      } else if (result.syncPayload.pendingUpdates.length > 0) {
        setActiveTab("activity");
        setStatusNote(
          `${result.syncPayload.pendingUpdates.length} update(s) ready to review below — open in Excel to write cells`
        );
      }
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [applySyncState, authSession, workbookId]);

  useEffect(() => {
    if (!authSession) return;
    void refreshState();
  }, [authSession, refreshState]);

  const handleGoogleSignIn = async (profileHint?: { email?: string; name?: string }) => {
    setIsSigningIn(true);
    setStatusNote(null);
    try {
      const session = await signInWithGoogle(getOrCreateWorkbookId(), profileHint);
      setAuthSession(session);
      setAuthStatus(session.authStatus);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Google Sign-In failed");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = () => {
    clearAuthSession();
    setAuthSession(null);
    setWatches([]);
    setPendingUpdates([]);
    setLogs([]);
    setPdfHints([]);
    setLatestDigest(undefined);
    setSelectedWatch(null);
    setPendingCount(0);
    setStatusNote(null);
  };

  const handleToggleWatch = async (watchId: string, enabled: boolean) => {
    try {
      const updated = await toggleWatchEnabled(workbookId, watchId, enabled);
      setWatches((prev) => prev.map((w) => (w.id === watchId ? updated : w)));
      setSelectedWatch((prev) => (prev?.id === watchId ? updated : prev));
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to update watch");
    }
  };

  const handleDeleteWatch = async (watchId: string) => {
    try {
      await deleteWatch(workbookId, watchId);
      setWatches((prev) => prev.filter((w) => w.id !== watchId));
      setSelectedWatch(null);
      setStatusNote("Watch removed");
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to delete watch");
    }
  };

  const handleRunNow = async (watchId: string) => {
    setRunningWatchId(watchId);
    setStatusNote(null);
    try {
      await runWatchNow(workbookId, watchId);
      await handleSyncNow();
      setSelectedWatch(null);
      setActiveTab("activity");
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Run failed");
    } finally {
      setRunningWatchId(null);
    }
  };

  const handleRunAllOvernight = async () => {
    setIsRunningAll(true);
    setStatusNote(null);
    try {
      const res = await triggerAllWatchesAlarm(workbookId);
      await handleSyncNow();
      setActiveTab("activity");
      setStatusNote(
        `Finished ${res.watchesRun} watch(es), ${res.pendingUpdates.length} update(s) ready`
      );
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Overnight run failed");
    } finally {
      setIsRunningAll(false);
    }
  };

  const handleEnableTemplate = async (template: WatchTemplate) => {
    setCreatingTemplateId(template.id);
    setStatusNote(null);
    try {
      await ensureTemplateTable(template);
      const watchPayload = createWatchFromTemplate(template.id, workbookId);
      await upsertWatch(watchPayload);
      await refreshState();
      setActiveTab("watches");
      setStatusNote(`Enabled "${template.title}" for ${authSession?.user.email}`);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to enable template");
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const handleSourceChange = (source: ConnectorChoice) => {
    setNewSource(source);
    const preset = CONNECTOR_PRESETS[source];
    setNewSheetName(preset.defaultSheetName);
    setNewQuery(preset.defaultQuery);
    setNewMatchKeys(preset.defaultMatchKeys.join(", "));
    setNewColumns(preset.defaultColumns.join(", "));
    setNewName(preset.label.split(" (")[0]!);
  };

  const handleCreateCustomWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const columns = newColumns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const matchKeyColumns = newMatchKeys
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (columns.length === 0 || matchKeyColumns.length === 0) {
      setStatusNote("Specify at least one column and one match key column");
      return;
    }

    try {
      await ensureTemplateTable({ sheetName: newSheetName, columns });
      await upsertWatch({
        workbookId,
        name: newName.trim() || "Custom Watch",
        templateId: "custom",
        source: newSource,
        sheetName: newSheetName.trim() || "Sheet1",
        scheduleCron: newCron.trim() || "0 8 * * *",
        composioQuery: newQuery.trim() || "*",
        matchKeyColumns,
        columns,
        anomalyThresholdPct: newAnomalyPct,
        maxEmailsPerRun: newMaxEmails,
        maxConsecutiveErrors: 3,
        enabled: true,
      });
      await refreshState();
      setShowNewWatchModal(false);
      setActiveTab("watches");
      setStatusNote(`Created watch "${newName.trim()}"`);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to create watch");
    }
  };

  const handleAddPdfHint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hintLabel.trim() || !hintPattern.trim() || !hintPassword.trim()) return;
    try {
      await addPdfHint(workbookId, {
        label: hintLabel.trim(),
        senderPattern: hintPattern.trim(),
        password: hintPassword,
      });
      setHintLabel("");
      setHintPattern("");
      setHintPassword("");
      await refreshState();
      setStatusNote("Saved encrypted statement password");
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to save PDF hint");
    }
  };

  const handleDeletePdfHint = async (hintId: string) => {
    try {
      await deletePdfHint(workbookId, hintId);
      await refreshState();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to remove PDF hint");
    }
  };

  const handleRevertLog = async (logId: string) => {
    try {
      const res = await revertAgentLog(workbookId, logId);
      await refreshState();
      setStatusNote(`Reverted ${res.revertedUpdates} queued update(s)`);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to revert batch");
    }
  };

  // Screen 1: Warm Cream Onboarding + Google Account Scoping (Laptop + Excel responsive)
  if (!authSession) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#FAF7F0] p-4 sm:p-6">
        <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-3xl border border-[#ECE7DC] bg-white shadow-[0_14px_45px_rgba(20,24,44,0.07)] md:grid-cols-2">
          {/* Left: Friendly mascot + brand welcome */}
          <div className="flex flex-col justify-between bg-[#F7F3EA] p-6 sm:p-8">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#34A853] to-[#107C41] text-sm font-bold text-white shadow-xs">
                  S
                </span>
                <span className="text-lg font-bold tracking-tight text-[#14182C]">Sheetdot</span>
              </div>

              <h1 className="mt-6 text-2xl font-bold leading-tight text-[#14182C] sm:text-3xl">
                Make every sheet run while you sleep!
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[#5D5B55]">
                Your watches, PDF password vault, and overnight history stay isolated to your
                signed-in Google account.
              </p>
            </div>

            <div className="mt-6 flex justify-center md:justify-end">
              <WavingPurpleMascot className="h-36 w-36" />
            </div>
          </div>

          {/* Right: Google Sign-In & Per-User Account Picker */}
          <div className="flex flex-col justify-between p-6 sm:p-8">
            <div>
              <h2 className="text-base font-bold text-[#14182C]">Sign in to continue</h2>
              <p className="mt-1 text-xs text-[#6B7280]">
                One click connects your private workspace and read-only Gmail access.
              </p>

              <ul className="mt-5 space-y-2.5 text-xs text-[#374151]">
                <li className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8E4D]" />
                  <span>Each Google account gets its own isolated agent storage</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8E4D]" />
                  <span>Read-only Gmail access — never sends or deletes emails</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8E4D]" />
                  <span>Row-safe updates with source email comments in Excel</span>
                </li>
              </ul>

              {statusNote && (
                <div className="mt-4 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
                  {statusNote}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-2.5">
              <button
                type="button"
                onClick={() =>
                  void handleGoogleSignIn({ email: "vishal@gmail.com", name: "Vishal Agrawal" })
                }
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2.5 rounded-full bg-[#14182C] px-5 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1E2440] disabled:opacity-50"
              >
                <GoogleMark />
                <span>
                  {isSigningIn ? "Signing in..." : "Sign in with Google (Vishal Agrawal)"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void handleGoogleSignIn({ email: "alex@gmail.com", name: "Alex Rivera" })
                }
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-[#E5DFD3] bg-white px-5 py-2.5 text-xs font-semibold text-[#14182C] hover:bg-[#FAF7F0] disabled:opacity-50"
              >
                <GoogleMark />
                <span>Try as Alex Rivera (alex@gmail.com)</span>
              </button>

              {showCustomAccountForm ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!customEmail.trim()) return;
                    void handleGoogleSignIn({
                      email: customEmail.trim(),
                      name: customName.trim() || customEmail.split("@")[0]!,
                    });
                  }}
                  className="space-y-2 rounded-2xl border border-[#ECE7DC] bg-[#FAF7F0] p-3"
                >
                  <input
                    type="email"
                    placeholder="Google email (e.g. priya@gmail.com)"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#DFD8CA] bg-white px-3 py-1.5 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Full name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="flex-1 rounded-xl border border-[#DFD8CA] bg-white px-3 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-[#1F8E4D] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Go
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCustomAccountForm(true)}
                  className="w-full pt-1 text-center text-[11px] font-medium text-[#6B7280] hover:text-[#14182C]"
                >
                  Use another Google email
                </button>
              )}

              <p className="flex items-center justify-center gap-1 pt-1 text-[10px] text-[#8E8A80]">
                <ShieldCheck className="h-3.5 w-3.5 text-[#1F8E4D]" />
                Data scoped strictly by Google identity
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Screen 2: Active Laptop-Friendly Warm Control Plane
  const firstName = authSession.user.name.split(" ")[0] || "there";

  return (
    <div className="min-h-screen w-full bg-[#FAF7F0] pb-24 text-[#14182C] md:pb-10">
      <ConnectionBanner
        user={authSession.user}
        activeTab={activeTab}
        watchCount={watches.length}
        logCount={logs.length}
        authStatus={authStatus}
        lastCheckedAt={lastCheckedAt}
        pdfHintsCount={pdfHints.length}
        isSyncing={isSyncing}
        isRunningAll={isRunningAll}
        onSelectTab={setActiveTab}
        onNewWatch={() => setShowNewWatchModal(true)}
        onMergeNow={handleSyncNow}
        onRunAll={handleRunAllOvernight}
        onOpenVault={() => setShowVaultModal(true)}
        onReconnectGmail={() => void handleGoogleSignIn({
          email: authSession.user.email,
          name: authSession.user.name,
        })}
        onSignOut={handleSignOut}
      />

      <main className="mx-auto max-w-5xl px-4 pt-5 sm:px-6 sm:pt-7">
        {/* Greeting + Account Scope indicator */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#8F652D] sm:text-2xl">
              {getGreeting()}, {firstName}! ☀️
            </h1>
            <p className="text-xs text-[#6B7280]">
              Private workspace for <span className="font-medium text-[#14182C]">{authSession.user.email}</span>
            </p>
          </div>
        </div>

        {/* Vibrant Green Overnight Summary Hero Banner with Peeking Green Mascot */}
        <section className="relative mt-6 rounded-2xl bg-gradient-to-r from-[#34A853] via-[#2EA04E] to-[#1F8E4D] p-5 text-white shadow-[0_10px_28px_rgba(31,142,77,0.22)] sm:p-6">
          <div className="pointer-events-none absolute -top-11 right-4 sm:right-8">
            <PeekingGreenMascot className="h-16 w-20 sm:h-20 sm:w-24" />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight sm:text-xl">Overnight Summary</h2>
              <p className="mt-1 text-xs text-white/90 sm:text-sm">
                {pendingCount > 0
                  ? `${pendingCount} ${pendingCount === 1 ? "update" : "updates"} ready to review`
                  : watches.length > 0
                    ? `${watches.filter((w) => w.enabled).length} active watch(es) running while Excel is closed`
                    : "Enable a template or add a watch to start overnight tracking"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {pendingCount > 0 ? (
                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  className="rounded-full bg-white px-5 py-2.5 text-xs font-bold text-[#14182C] shadow-sm transition hover:bg-[#FAF7F0] disabled:opacity-50 sm:text-sm"
                >
                  {isSyncing ? "Merging..." : "Merge to Sheet"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRunAllOvernight}
                  disabled={isRunningAll || watches.length === 0}
                  className="rounded-full bg-white px-5 py-2.5 text-xs font-bold text-[#14182C] shadow-sm transition hover:bg-[#FAF7F0] disabled:opacity-60 sm:text-sm"
                >
                  {isRunningAll ? "Running Sweep..." : "Run Overnight Sweep"}
                </button>
              )}
            </div>
          </div>
        </section>

        {statusNote && (
          <div className="mt-4 rounded-xl border border-[#E5DFD3] bg-white px-4 py-2.5 text-xs text-[#374151] shadow-2xs">
            {statusNote}
          </div>
        )}

        {/* Active Tab Content */}
        <section className="mt-6">
          {activeTab === "watches" && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#14182C]">Active Watches</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab("templates")}
                  className="text-xs font-semibold text-[#1F8E4D] hover:underline"
                >
                  Browse templates
                </button>
              </div>

              {watches.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#DFD8CA] bg-white p-8 text-center">
                  <p className="text-sm font-medium text-[#4B5563]">
                    No watches yet for {authSession.user.email}.
                  </p>
                  <p className="mt-1 text-xs text-[#8E8A80]">
                    Start from a template or create a custom watch to scan overnight.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab("templates")}
                      className="rounded-full bg-[#1F8E4D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#107C41]"
                    >
                      Browse Templates
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewWatchModal(true)}
                      className="rounded-full border border-[#E5DFD3] bg-white px-4 py-2 text-xs font-semibold text-[#14182C] hover:bg-[#FAF7F0]"
                    >
                      + New Watch
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
                  {watches.map((watch) => (
                    <WatchCard
                      key={watch.id}
                      watch={watch}
                      onToggle={handleToggleWatch}
                      onSelect={setSelectedWatch}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "templates" && (
            <TemplatePicker
              existingWatches={watches}
              creatingTemplateId={creatingTemplateId}
              onSelectTemplate={handleEnableTemplate}
            />
          )}

          {activeTab === "activity" && (
            <LogList
              logs={logs}
              pendingUpdates={pendingUpdates}
              watches={watches}
              latestDigest={latestDigest}
              onRevertLog={handleRevertLog}
            />
          )}
        </section>
      </main>

      {/* Narrow-viewport / Excel Task Pane floating pill bottom bar */}
      <div className="fixed inset-x-0 bottom-3 z-30 flex justify-center px-4 md:hidden">
        <nav className="relative flex w-full max-w-[320px] items-center justify-around rounded-full border border-[#ECE7DC] bg-white px-3 py-2 shadow-[0_8px_28px_rgba(20,24,44,0.12)]">
          <button
            type="button"
            onClick={() => setActiveTab("watches")}
            className={`flex flex-col items-center gap-0.5 text-[11px] font-semibold ${
              activeTab === "watches" ? "text-[#14182C]" : "text-[#8E8A80]"
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>Watches</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNewWatchModal(true)}
            aria-label="New Watch"
            className="-mt-7 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#34A853] to-[#107C41] text-white shadow-md ring-4 ring-[#FAF7F0]"
          >
            <Plus className="h-6 w-6" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("templates")}
            className={`flex flex-col items-center gap-0.5 text-[11px] font-semibold ${
              activeTab === "templates" ? "text-[#14182C]" : "text-[#8E8A80]"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>Templates</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            className={`flex flex-col items-center gap-0.5 text-[11px] font-semibold ${
              activeTab === "activity" ? "text-[#14182C]" : "text-[#8E8A80]"
            }`}
          >
            <Bell className="h-4 w-4" />
            <span>Activity</span>
          </button>
        </nav>
      </div>

      {/* Watch Detail Drawer/Modal (Screen 3 inspired) */}
      {selectedWatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]">
          <div className="relative mt-6 w-full max-w-md rounded-3xl border border-[#ECE7DC] bg-white p-5 shadow-2xl">
            <div className="pointer-events-none absolute -top-12 right-6">
              <DetailPinkMascot className="h-16 w-20" />
            </div>

            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-block rounded-full bg-[#EDE9FE] px-2.5 py-0.5 text-[10px] font-semibold text-[#5B21B6]">
                  {selectedWatch.source ?? "gmail"}
                </span>
                <h2 className="mt-1.5 text-lg font-bold text-[#14182C]">{selectedWatch.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWatch(null)}
                className="rounded-full p-1 text-[#6B7280] hover:bg-[#FAF7F0] hover:text-[#14182C]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 rounded-2xl bg-[#FAF7F0] p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[#6B7280]">
                  <Calendar className="h-3.5 w-3.5" />
                  Schedule
                </span>
                <span className="font-semibold text-[#14182C]">
                  {formatCronBadge(selectedWatch.scheduleCron)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Target Sheet</span>
                <span className="font-semibold text-[#14182C]">{selectedWatch.sheetName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Match Keys</span>
                <span className="font-mono text-[11px] font-semibold text-[#14182C]">
                  {selectedWatch.matchKeyColumns.join(", ")}
                </span>
              </div>
              <div>
                <span className="text-[#6B7280]">Filter Query</span>
                <p className="mt-1 break-words rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#374151]">
                  {selectedWatch.composioQuery}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void handleDeleteWatch(selectedWatch.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#FCA5A5] px-3.5 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>

              <button
                type="button"
                onClick={() => void handleRunNow(selectedWatch.id)}
                disabled={runningWatchId === selectedWatch.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#2EA04E] to-[#107C41] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {runningWatchId === selectedWatch.id ? "Running..." : "Run Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Watch Modal */}
      {showNewWatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]">
          <form
            onSubmit={handleCreateCustomWatch}
            className="w-full max-w-md rounded-3xl border border-[#ECE7DC] bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#F1EDE4] pb-3">
              <h2 className="text-base font-bold text-[#14182C]">Create 24/7 Watch</h2>
              <button
                type="button"
                onClick={() => setShowNewWatchModal(false)}
                className="rounded-full p-1 text-[#6B7280] hover:bg-[#FAF7F0]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3.5 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-[#374151]">Connector Source</label>
                <select
                  value={newSource}
                  onChange={(e) => handleSourceChange(e.target.value as ConnectorChoice)}
                  className="w-full rounded-xl border border-[#DFD8CA] bg-[#FAF7F0] px-3 py-2"
                >
                  {Object.values(CONNECTOR_PRESETS).map((preset) => (
                    <option key={preset.source} value={preset.source}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block font-semibold text-[#374151]">Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#374151]">Sheet Tab</label>
                  <input
                    type="text"
                    value={newSheetName}
                    onChange={(e) => setNewSheetName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-[#374151]">Search Filter</label>
                <input
                  type="text"
                  value={newQuery}
                  onChange={(e) => setNewQuery(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-[#374151]">Columns</label>
                <input
                  type="text"
                  value={newColumns}
                  onChange={(e) => setNewColumns(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block font-semibold text-[#374151]">Match Keys</label>
                  <input
                    type="text"
                    value={newMatchKeys}
                    onChange={(e) => setNewMatchKeys(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#374151]">Cron Schedule</label>
                  <input
                    type="text"
                    value={newCron}
                    onChange={(e) => setNewCron(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block font-semibold text-[#374151]">
                    Spike Alert (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={newAnomalyPct}
                    onChange={(e) => setNewAnomalyPct(Number(e.target.value))}
                    className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#374151]">
                    Max Items / Run
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newMaxEmails}
                    onChange={(e) => setNewMaxEmails(Number(e.target.value))}
                    className="w-full rounded-xl border border-[#DFD8CA] px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-[#F1EDE4] pt-3">
              <button
                type="button"
                onClick={() => setShowNewWatchModal(false)}
                className="rounded-full border border-[#E5DFD3] px-4 py-2 text-xs font-semibold text-[#374151] hover:bg-[#FAF7F0]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full bg-[#1F8E4D] px-5 py-2 text-xs font-semibold text-white hover:bg-[#107C41]"
              >
                Save Watch
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PDF Password Vault Modal */}
      {showVaultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-[#ECE7DC] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#F1EDE4] pb-3">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-[#1F8E4D]" />
                <h2 className="text-base font-bold text-[#14182C]">PDF Password Vault</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowVaultModal(false)}
                className="rounded-full p-1 text-[#6B7280] hover:bg-[#FAF7F0]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-2.5 text-xs text-[#6B7280]">
              Stored privately for <span className="font-semibold text-[#14182C]">{authSession.user.email}</span> so overnight runs unlock bank &amp; card PDFs automatically.
            </p>

            <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {pdfHints.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#DFD8CA] p-3 text-center text-xs text-[#6B7280]">
                  No statement passwords saved yet.
                </div>
              ) : (
                pdfHints.map((hint) => (
                  <div
                    key={hint.id}
                    className="flex items-center justify-between rounded-xl border border-[#ECE7DC] bg-[#FAF7F0] px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#14182C]">{hint.label}</p>
                      <p className="truncate text-[11px] text-[#6B7280]">
                        Matches: {hint.senderPattern}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeletePdfHint(hint.id)}
                      className="ml-2 text-[#6B7280] hover:text-[#DC2626]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleAddPdfHint}
              className="mt-4 space-y-2.5 border-t border-[#F1EDE4] pt-3.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#14182C]">Add Password</span>
                <button
                  type="button"
                  onClick={() => {
                    setHintLabel("SBI Card Statement");
                    setHintPattern("sbicard.com");
                    setHintPassword("demo-sbi-password");
                  }}
                  className="text-[11px] font-semibold text-[#1F8E4D] hover:underline"
                >
                  Fill Demo SBI
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Label (e.g. HDFC Regalia)"
                  value={hintLabel}
                  onChange={(e) => setHintLabel(e.target.value)}
                  required
                  className="rounded-xl border border-[#DFD8CA] px-3 py-1.5"
                />
                <input
                  type="text"
                  placeholder="Sender (e.g. sbicard.com)"
                  value={hintPattern}
                  onChange={(e) => setHintPattern(e.target.value)}
                  required
                  className="rounded-xl border border-[#DFD8CA] px-3 py-1.5"
                />
              </div>
              <input
                type="password"
                placeholder="PDF password"
                value={hintPassword}
                onChange={(e) => setHintPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-[#DFD8CA] px-3 py-1.5"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-full bg-[#1F8E4D] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#107C41]"
                >
                  Save Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
