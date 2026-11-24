import { RefreshCw, ShieldCheck, AlertTriangle, Link2 } from "lucide-react";
import type { ConnectionAuthStatus } from "@sheetdot/shared";

interface ConnectionBannerProps {
  authStatus: ConnectionAuthStatus;
  lastCheckedAt?: string;
  pendingCount: number;
  isSyncing: boolean;
  onSyncNow: () => void;
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
  isSyncing,
  onSyncNow,
  onConnectGmail,
}: ConnectionBannerProps) {
  return (
    <header className="border-b border-[#E5E7EB] bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#107C41] text-[11px] font-bold text-white">
            S
          </span>
          <span className="text-sm font-semibold tracking-tight text-[#111827]">Sheetdot</span>
        </div>

        <button
          type="button"
          onClick={onSyncNow}
          disabled={isSyncing}
          title="Sync overnight updates into Excel"
          className="inline-flex items-center gap-1.5 rounded border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-[#107C41] ${isSyncing ? "animate-spin" : ""}`} />
          <span>{isSyncing ? "Syncing" : "Sync Now"}</span>
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {authStatus === "connected" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-medium text-[#065F46]">
            <ShieldCheck className="h-3 w-3 text-[#107C41]" />
            Connected (Read-Only)
          </span>
        ) : authStatus === "auth_expired" ? (
          <button
            type="button"
            onClick={onConnectGmail}
            className="inline-flex items-center gap-1 rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[11px] font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
          >
            <AlertTriangle className="h-3 w-3" />
            Reconnect Gmail
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnectGmail}
            className="inline-flex items-center gap-1 rounded bg-[#107C41] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#0D6535]"
          >
            <Link2 className="h-3 w-3" />
            Connect Gmail
          </button>
        )}

        <span className="text-[11px] text-[#6B7280]">
          Last checked: {formatLastChecked(lastCheckedAt)}
        </span>
      </div>

      {pendingCount > 0 && (
        <div className="mt-2 rounded border border-[#FDE68A] bg-[#FEFCE8] px-2 py-1 text-[11px] text-[#854D0E]">
          {pendingCount} overnight {pendingCount === 1 ? "change" : "changes"} ready to merge
        </div>
      )}
    </header>
  );
}
