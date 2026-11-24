import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, X, Lock } from "lucide-react";
import {
  CONNECTOR_PRESETS,
  createWatchFromTemplate,
  type AgentLogEntry,
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
  deletePdfHint,
  deleteWatch,
  fetchSyncState,
  getComposioAuth,
  getOrCreateWorkbookId,
  revertAgentLog,
  runWatchNow,
  toggleWatchEnabled,
  triggerAllWatchesAlarm,
  upsertWatch,
} from "../lib/api.js";
import { ensureTemplateTable, syncWorkbookWithExcel } from "../sync/excelSync.js";
import { ConnectionBanner } from "./components/ConnectionBanner.js";
import { LogList } from "./components/LogList.js";
import { TemplatePicker } from "./components/TemplatePicker.js";
import { WatchCard } from "./components/WatchCard.js";

type ActiveTab = "watches" | "templates" | "activity";
type ConnectorChoice = Exclude<WatchSourceType, "cell_watch">;

export function App() {
  const [workbookId] = useState<string>(() => getOrCreateWorkbookId());
  const [activeTab, setActiveTab] = useState<ActiveTab>("watches");
  const [watches, setWatches] = useState<WatchConfig[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<PendingRowUpdate[]>([]);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [latestDigest, setLatestDigest] = useState<DigestSummary | undefined>(undefined);
  const [pdfHints, setPdfHints] = useState<PdfPasswordHint[]>([]);
  const [authStatus, setAuthStatus] = useState<ConnectionAuthStatus>("connected");
  const [lastCheckedAt, setLastCheckedAt] = useState<string | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [runningWatchId, setRunningWatchId] = useState<string | null>(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // New Custom Watch modal state
  const [showNewWatchModal, setShowNewWatchModal] = useState(false);
  const [newSource, setNewSource] = useState<ConnectorChoice>("gmail");
  const [newName, setNewName] = useState("Custom Inbox Watch");
  const [newSheetName, setNewSheetName] = useState(CONNECTOR_PRESETS.gmail.defaultSheetName);
  const [newQuery, setNewQuery] = useState(CONNECTOR_PRESETS.gmail.defaultQuery);
  const [newCron, setNewCron] = useState("0 8 * * *");
  const [newMatchKeys, setNewMatchKeys] = useState(
    CONNECTOR_PRESETS.gmail.defaultMatchKeys.join(", ")
  );
  const [newColumns, setNewColumns] = useState(CONNECTOR_PRESETS.gmail.defaultColumns.join(", "));
  const [newAnomalyPct, setNewAnomalyPct] = useState(20);
  const [newMaxEmails, setNewMaxEmails] = useState(25);

  // PDF Password Vault drawer state
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [hintLabel, setHintLabel] = useState("");
  const [hintPattern, setHintPattern] = useState("");
  const [hintPassword, setHintPassword] = useState("");
  const [hintDescription, setHintDescription] = useState("");

  const applySyncState = useCallback((sync: Awaited<ReturnType<typeof fetchSyncState>>, inExcel: boolean) => {
    setWatches(sync.watches);
    setPendingUpdates(inExcel ? [] : sync.pendingUpdates);
    setLogs(sync.agentLogs);
    setAuthStatus(sync.authStatus);
    setLastCheckedAt(sync.lastCheckedAt);
    setLatestDigest(sync.latestDigest);
    setPdfHints(sync.pdfHints ?? []);
    setPendingCount(inExcel ? 0 : sync.pendingUpdates.length);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const sync = await fetchSyncState(workbookId);
      applySyncState(sync, false);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Worker unreachable");
    }
  }, [applySyncState, workbookId]);

  const handleSyncNow = useCallback(async () => {
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
      }
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [applySyncState, workbookId]);

  useEffect(() => {
    void handleSyncNow();
  }, [handleSyncNow]);

  const handleConnectGmail = async () => {
    try {
      const auth = await getComposioAuth(workbookId);
      setAuthStatus(auth.authStatus);
      if (auth.redirectUrl && typeof window !== "undefined") {
        window.open(auth.redirectUrl, "_blank", "noopener,noreferrer");
      } else {
        setStatusNote(auth.message);
      }
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to initiate Gmail auth");
    }
  };

  const handleToggleWatch = async (watchId: string, enabled: boolean) => {
    try {
      const updated = await toggleWatchEnabled(workbookId, watchId, enabled);
      setWatches((prev) => prev.map((w) => (w.id === watchId ? updated : w)));
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to update watch");
    }
  };

  const handleDeleteWatch = async (watchId: string) => {
    try {
      await deleteWatch(workbookId, watchId);
      setWatches((prev) => prev.filter((w) => w.id !== watchId));
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
        `Overnight sweep finished: ${res.watchesRun} watch(es), ${res.pendingUpdates.length} queued change(s)`
      );
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Overnight sweep failed");
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
      setStatusNote(`Enabled "${template.title}" on tab "${template.sheetName}"`);
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
        hintDescription: hintDescription.trim() || undefined,
      });
      setHintLabel("");
      setHintPattern("");
      setHintPassword("");
      setHintDescription("");
      await refreshState();
      setStatusNote("Encrypted PDF password hint saved to Durable Object vault");
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
      setStatusNote(`Reverted ${res.revertedUpdates} queued update(s) from batch`);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Failed to revert batch");
    }
  };

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "watches", label: `Watches (${watches.length})` },
    { id: "templates", label: "Templates" },
    { id: "activity", label: `Activity${logs.length > 0 ? ` (${logs.length})` : ""}` },
  ];

  return (
    <div className="min-h-screen w-full bg-[#F9FAFB] text-[#111827] sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col overflow-hidden bg-white sm:min-h-[calc(100vh-3rem)] sm:rounded-xl sm:border sm:border-[#E5E7EB] sm:shadow-xs">
        <ConnectionBanner
          authStatus={authStatus}
          lastCheckedAt={lastCheckedAt}
          pendingCount={pendingCount}
          pdfHintsCount={pdfHints.length}
          isSyncing={isSyncing}
          isRunningAll={isRunningAll}
          onSyncNow={handleSyncNow}
          onRunAll={handleRunAllOvernight}
          onOpenVault={() => setShowVaultModal(true)}
          onConnectGmail={handleConnectGmail}
        />

        <nav className="grid grid-cols-3 border-b border-[#E5E7EB] bg-white sm:flex sm:gap-2 sm:px-5">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 py-2 text-center text-xs font-medium transition-colors sm:px-3 sm:py-2.5 sm:text-sm ${
                  isActive
                    ? "border-[#107C41] text-[#107C41]"
                    : "border-transparent text-[#6B7280] hover:text-[#111827]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {statusNote && (
          <div className="border-b border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 text-[11px] text-[#374151] sm:px-5 sm:py-2 sm:text-xs">
            {statusNote}
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-3 sm:p-5">
          {activeTab === "watches" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[#6B7280] sm:text-xs">
                  Scheduled watches run via Cloudflare Durable Object alarms even when Excel is
                  closed.
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewWatchModal(true)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#107C41] px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-[#0D6535] sm:text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Watch
                </button>
              </div>

              {watches.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-center sm:p-10">
                  <p className="text-xs text-[#4B5563] sm:text-sm">
                    No 24/7 watches configured yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("templates")}
                    className="mt-3 rounded-md bg-[#107C41] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0D6535] sm:text-sm"
                  >
                    Browse Templates
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {watches.map((watch) => (
                    <WatchCard
                      key={watch.id}
                      watch={watch}
                      isRunning={runningWatchId === watch.id}
                      onToggle={handleToggleWatch}
                      onRunNow={handleRunNow}
                      onDelete={handleDeleteWatch}
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
        </main>
      </div>

      {showNewWatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
          <form
            onSubmit={handleCreateCustomWatch}
            className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-lg sm:p-5"
          >
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2.5">
              <h2 className="text-sm font-semibold text-[#111827]">Create 24/7 Watch</h2>
              <button
                type="button"
                onClick={() => setShowNewWatchModal(false)}
                className="text-[#6B7280] hover:text-[#111827]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2.5 text-xs">
              <div>
                <label className="mb-1 block font-medium text-[#374151]">Connector Source</label>
                <select
                  value={newSource}
                  onChange={(e) => handleSourceChange(e.target.value as ConnectorChoice)}
                  className="w-full rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5"
                >
                  {Object.values(CONNECTOR_PRESETS).map((preset) => (
                    <option key={preset.source} value={preset.source}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-medium text-[#374151]">Watch Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#374151]">Sheet Tab</label>
                  <input
                    type="text"
                    value={newSheetName}
                    onChange={(e) => setNewSheetName(e.target.value)}
                    required
                    className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-[#374151]">Filter Query</label>
                <input
                  type="text"
                  value={newQuery}
                  onChange={(e) => setNewQuery(e.target.value)}
                  required
                  className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-[#374151]">
                  Columns (comma-separated)
                </label>
                <input
                  type="text"
                  value={newColumns}
                  onChange={(e) => setNewColumns(e.target.value)}
                  required
                  className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block font-medium text-[#374151]">
                    Match Key Columns
                  </label>
                  <input
                    type="text"
                    value={newMatchKeys}
                    onChange={(e) => setNewMatchKeys(e.target.value)}
                    required
                    className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#374151]">Cron</label>
                  <input
                    type="text"
                    value={newCron}
                    onChange={(e) => setNewCron(e.target.value)}
                    required
                    className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-medium text-[#374151]">
                    Anomaly Spike (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={newAnomalyPct}
                    onChange={(e) => setNewAnomalyPct(Number(e.target.value))}
                    className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#374151]">
                    Max Items / Run
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newMaxEmails}
                    onChange={(e) => setNewMaxEmails(Number(e.target.value))}
                    className="w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-[#E5E7EB] pt-3">
              <button
                type="button"
                onClick={() => setShowNewWatchModal(false)}
                className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-[#107C41] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0D6535]"
              >
                Create Watch
              </button>
            </div>
          </form>
        </div>
      )}

      {showVaultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
          <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-lg sm:p-5">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2.5">
              <div className="flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-[#107C41]" />
                <h2 className="text-sm font-semibold text-[#111827]">
                  PDF Password-Hint Vault
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowVaultModal(false)}
                className="text-[#6B7280] hover:text-[#111827]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-2 text-[11px] text-[#6B7280]">
              Passwords are encrypted with AES-GCM inside your Durable Object so overnight agents
              can unlock bank &amp; credit card PDF statements automatically.
            </p>

            <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {pdfHints.length === 0 ? (
                <div className="rounded border border-dashed border-[#E5E7EB] p-3 text-center text-[11px] text-[#6B7280]">
                  No PDF password hints stored yet.
                </div>
              ) : (
                pdfHints.map((hint) => (
                  <div
                    key={hint.id}
                    className="flex items-center justify-between rounded-md border border-[#E5E7EB] px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#111827]">{hint.label}</p>
                      <p className="truncate text-[11px] text-[#6B7280]">
                        Matches: {hint.senderPattern}
                        {hint.hintDescription ? ` · ${hint.hintDescription}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePdfHint(hint.id)}
                      className="ml-2 text-[#6B7280] hover:text-[#DC2626]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddPdfHint} className="mt-3 space-y-2 border-t border-[#E5E7EB] pt-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#111827]">Add Statement Password</span>
                <button
                  type="button"
                  onClick={() => {
                    setHintLabel("SBI Card Statement");
                    setHintPattern("sbicard.com");
                    setHintPassword("demo-sbi-password");
                    setHintDescription("Mock demo statement");
                  }}
                  className="text-[11px] font-medium text-[#107C41] hover:underline"
                >
                  Fill Demo SBI Hint
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Label (e.g. HDFC Regalia)"
                  value={hintLabel}
                  onChange={(e) => setHintLabel(e.target.value)}
                  required
                  className="rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                />
                <input
                  type="text"
                  placeholder="Sender pattern (e.g. sbicard.com)"
                  value={hintPattern}
                  onChange={(e) => setHintPattern(e.target.value)}
                  required
                  className="rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="password"
                  placeholder="PDF password"
                  value={hintPassword}
                  onChange={(e) => setHintPassword(e.target.value)}
                  required
                  className="rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                />
                <input
                  type="text"
                  placeholder="Hint note (optional)"
                  value={hintDescription}
                  onChange={(e) => setHintDescription(e.target.value)}
                  className="rounded-md border border-[#E5E7EB] px-2.5 py-1.5"
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="rounded-md bg-[#107C41] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0D6535]"
                >
                  Save Encrypted Hint
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
