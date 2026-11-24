import { RefreshCw, ShieldCheck, AlertTriangle, Link2, KeyRound, PlayCircle } from "lucide-react";
import type { ConnectionAuthStatus } from "@sheetdot/shared";

interface ConnectionBannerProps {
  authStatus: ConnectionAuthStatus;
  lastCheckedAt?: string;
  pendingCount: number;
  pdfHintsCount: number;
  isSyncing: boolean;
  isRunningAll: boolean;
  onSyncNow: () => void;
  onRunAll: () => void;
  onOpenVault: () => void;
  onConnectGmail: () => void;
}

function formatLastChecked(iso?: string): string {
  if (!iso) return "Not checked yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ConnectionBanner({
  authStatus,
  lastCheckedAt,
  pendingCount,
  pdfHintsCount,
  isSyncing,
  isRunningAll,
  onSyncNow,
  onRunAll,
  onOpenVault,
  onConnectGmail,
}: ConnectionBannerProps) {
  return (
    <header className="border-b border-[#E5E7EB] bg-white px-3 py-2.5 sm:px-5 sm:py-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#107C41] text-xs font-bold text-white">
              S
            </span>
            <div>
              <span className="text-sm font-semibold tracking-tight text-[#111827] sm:text-base">
                Sheetdot
              </span>
              <p className="hidden text-xs text-[#6B7280] sm:block">
                24/7 Excel Agent Control Plane
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSyncNow}
            disabled={isSyncing}
            title="Sync overnight updates into Excel"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50 sm:hidden"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#107C41] ${isSyncing ? "animate-spin" : ""}`} />
            <span>{isSyncing ? "Syncing" : "Sync Now"}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-2.5">
          {authStatus === "connected" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-medium text-[#065F46] sm:text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-[#107C41]" />
              Connected (Read-Only)
            </span>
          ) : authStatus === "auth_expired" ? (
            <button
              type="button"
              onClick={onConnectGmail}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-medium text-[#B91C1C] hover:bg-[#FEE2E2] sm:text-xs"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Reconnect Gmail
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnectGmail}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#107C41] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#0D6535] sm:text-xs"
            >
              <Link2 className="h-3.5 w-3.5" />
              Connect Gmail
            </button>
          )}

          <span className="text-[11px] text-[#6B7280] sm:text-xs">
            Last checked: {formatLastChecked(lastCheckedAt)}
          </span>

          <button
            type="button"
            onClick={onOpenVault}
            title="Manage encrypted PDF password hints"
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-medium text-[#374151] hover:bg-[#F9FAFB] sm:px-2.5 sm:py-1.5 sm:text-xs"
          >
            <KeyRound className="h-3.5 w-3.5 text-[#107C41]" />
            <span>PDF Vault{pdfHintsCount > 0 ? ` (${pdfHintsCount})` : ""}</span>
          </button>

          <button
            type="button"
            onClick={onRunAll}
            disabled={isRunningAll}
            title="Run overnight alarm loop across all enabled watches"
            className="hidden items-center gap-1.5 rounded-md bg-[#107C41] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0D6535] disabled:opacity-50 sm:inline-flex"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            <span>{isRunningAll ? "Running..." : "Run Overnight Sweep"}</span>
          </button>

          <button
            type="button"
            onClick={onSyncNow}
            disabled={isSyncing}
            title="Sync overnight updates into Excel"
            className="hidden items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50 sm:inline-flex"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#107C41] ${isSyncing ? "animate-spin" : ""}`} />
            <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
          </button>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="mt-2.5 rounded-md border border-[#FDE68A] bg-[#FEFCE8] px-2.5 py-1.5 text-[11px] text-[#854D0E] sm:px-3 sm:text-xs">
          {pendingCount} overnight {pendingCount === 1 ? "change" : "changes"} queued to merge into
          Excel
        </div>
      )}
    </header>
  );
}
