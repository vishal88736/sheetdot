import { useCallback, useEffect, useState } from "react";
import {
  createWatchFromTemplate,
  type AgentLogEntry,
  type ConnectionAuthStatus,
  type WatchConfig,
  type WatchTemplate,
} from "@sheetdot/shared";
import {
  fetchSyncState,
  getComposioAuth,
  getOrCreateWorkbookId,
  runWatchNow,
  toggleWatchEnabled,
  upsertWatch,
} from "../lib/api.js";
import { ensureTemplateTable, syncWorkbookWithExcel } from "../sync/excelSync.js";
import { ConnectionBanner } from "./components/ConnectionBanner.js";
import { LogList } from "./components/LogList.js";
import { TemplatePicker } from "./components/TemplatePicker.js";
import { WatchCard } from "./components/WatchCard.js";

type ActiveTab = "watches" | "templates" | "activity";

export function App() {
  const [workbookId] = useState<string>(() => getOrCreateWorkbookId());
  const [activeTab, setActiveTab] = useState<ActiveTab>("watches");
  const [watches, setWatches] = useState<WatchConfig[]>([]);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [authStatus, setAuthStatus] = useState<ConnectionAuthStatus>("connected");
  const [lastCheckedAt, setLastCheckedAt] = useState<string | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [runningWatchId, setRunningWatchId] = useState<string | null>(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const sync = await fetchSyncState(workbookId);
      setWatches(sync.watches);
      setLogs(sync.agentLogs);
      setAuthStatus(sync.authStatus);
      setLastCheckedAt(sync.lastCheckedAt);
      setPendingCount(sync.pendingUpdates.length);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Worker unreachable");
    }
  }, [workbookId]);

  const handleSyncNow = useCallback(async () => {
    setIsSyncing(true);
    setStatusNote(null);
    try {
      const result = await syncWorkbookWithExcel(workbookId);
      setWatches(result.syncPayload.watches);
      setLogs(result.syncPayload.agentLogs);
      setAuthStatus(result.syncPayload.authStatus);
      setLastCheckedAt(result.syncPayload.lastCheckedAt);

      if (result.inExcelHost) {
        setPendingCount(0);
        setStatusNote(
          result.rowsAdded + result.rowsUpdated > 0
            ? `Merged +${result.rowsAdded} new, ${result.rowsUpdated} updated`
            : "Workbook is up to date"
        );
      } else {
        setPendingCount(result.syncPayload.pendingUpdates.length);
      }
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [workbookId]);

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

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "watches", label: `Watches (${watches.length})` },
    { id: "templates", label: "Templates" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[320px] flex-col border-x border-[#E5E7EB] bg-white text-[#111827]">
      <ConnectionBanner
        authStatus={authStatus}
        lastCheckedAt={lastCheckedAt}
        pendingCount={pendingCount}
        isSyncing={isSyncing}
        onSyncNow={handleSyncNow}
        onConnectGmail={handleConnectGmail}
      />

      <nav className="grid grid-cols-3 border-b border-[#E5E7EB] bg-white">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 py-2 text-center text-xs font-medium transition-colors ${
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
        <div className="border-b border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 text-[11px] text-[#374151]">
          {statusNote}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-3">
        {activeTab === "watches" && (
          <div className="space-y-2.5">
            {watches.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center">
                <p className="text-xs text-[#4B5563]">No 24/7 watches configured yet.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab("templates")}
                  className="mt-2.5 rounded bg-[#107C41] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0D6535]"
                >
                  Browse Templates
                </button>
              </div>
            ) : (
              watches.map((watch) => (
                <WatchCard
                  key={watch.id}
                  watch={watch}
                  isRunning={runningWatchId === watch.id}
                  onToggle={handleToggleWatch}
                  onRunNow={handleRunNow}
                />
              ))
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

        {activeTab === "activity" && <LogList logs={logs} />}
      </main>
    </div>
  );
}

export default App;
