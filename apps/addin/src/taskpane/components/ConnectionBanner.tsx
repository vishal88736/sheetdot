import { useEffect, useRef, useState } from "react";
import {
  KeyRound,
  LogOut,
  Menu,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import type { AuthUserProfile, ConnectionAuthStatus } from "@sheetdot/shared";

type ActiveTab = "watches" | "templates" | "activity";

interface ConnectionBannerProps {
  user: AuthUserProfile;
  activeTab: ActiveTab;
  watchCount: number;
  logCount: number;
  authStatus: ConnectionAuthStatus;
  lastCheckedAt?: string;
  pdfHintsCount: number;
  isSyncing: boolean;
  isRunningAll: boolean;
  onSelectTab: (tab: ActiveTab) => void;
  onNewWatch: () => void;
  onMergeNow: () => void;
  onRunAll: () => void;
  onOpenVault: () => void;
  onReconnectGmail: () => void;
  onSignOut: () => void;
}

function formatLastChecked(iso?: string): string {
  if (!iso) return "Not checked yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ConnectionBanner({
  user,
  activeTab,
  watchCount,
  logCount,
  authStatus,
  lastCheckedAt,
  pdfHintsCount,
  isSyncing,
  isRunningAll,
  onSelectTab,
  onNewWatch,
  onMergeNow,
  onRunAll,
  onOpenVault,
  onReconnectGmail,
  onSignOut,
}: ConnectionBannerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen || typeof document === "undefined") return;
    const handleOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  const statusDotColor =
    authStatus === "connected"
      ? "bg-[#2EA04E]"
      : authStatus === "auth_expired"
        ? "bg-[#EF4444]"
        : "bg-[#F59E0B]";

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "watches", label: `Watches (${watchCount})` },
    { id: "templates", label: "Templates" },
    { id: "activity", label: `Activity${logCount > 0 ? ` (${logCount})` : ""}` },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-[#ECE7DC] bg-[#FAF7F0]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        {/* Left: Menu shortcut (mobile) + Sheetdot wordmark */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenVault}
            title="PDF Password Vault & Settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-[#14182C] hover:bg-white/80 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-[#34A853] to-[#107C41] text-xs font-bold text-white shadow-xs">
              S
            </span>
            <span className="text-lg font-bold tracking-tight text-[#14182C]">Sheetdot</span>
          </div>
        </div>

        {/* Center: Laptop segmented pill tabs */}
        <nav className="hidden items-center gap-1 rounded-full border border-[#E8E2D6] bg-white/90 p-1 shadow-2xs md:flex">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-[#14182C] text-white shadow-xs"
                    : "text-[#6B7280] hover:text-[#14182C]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right: + New Watch (laptop) + Google User Avatar Pill */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onNewWatch}
            className="hidden items-center gap-1.5 rounded-full bg-gradient-to-r from-[#2EA04E] to-[#107C41] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:opacity-95 md:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" />
            New Watch
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="Google account menu"
              className="inline-flex items-center gap-2 rounded-full border border-[#E5DFD3] bg-white p-1 shadow-2xs transition hover:border-[#D4CDC0] md:pr-2.5"
            >
              <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#107C41] text-xs font-bold text-white">
                {user.initials}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${statusDotColor}`}
                />
              </span>
              <span className="hidden max-w-[110px] truncate text-xs font-medium text-[#14182C] md:inline">
                {user.name.split(" ")[0]}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-[#E8E2D6] bg-white p-2 shadow-xl">
                <div className="rounded-xl bg-[#FAF7F0] px-3 py-2.5">
                  <p className="truncate text-xs font-bold text-[#14182C]">{user.name}</p>
                  <p className="truncate text-[11px] text-[#6B7280]">{user.email}</p>

                  <div className="mt-2 flex items-center justify-between text-[10px]">
                    {authStatus === "connected" ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[#107C41]">
                        <ShieldCheck className="h-3 w-3" />
                        Gmail Connected (Read-Only)
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onReconnectGmail();
                        }}
                        className="inline-flex items-center gap-1 font-semibold text-[#DC2626] hover:underline"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Reconnect Gmail
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-[#8E8A80]">
                    Last checked: {formatLastChecked(lastCheckedAt)}
                  </p>
                </div>

                <div className="mt-1.5 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onMergeNow();
                    }}
                    disabled={isSyncing}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-[#14182C] hover:bg-[#FAF7F0] disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 text-[#107C41] ${isSyncing ? "animate-spin" : ""}`}
                    />
                    <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRunAll();
                    }}
                    disabled={isRunningAll}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-[#14182C] hover:bg-[#FAF7F0] disabled:opacity-50"
                  >
                    <PlayCircle className="h-3.5 w-3.5 text-[#107C41]" />
                    <span>{isRunningAll ? "Running..." : "Run Overnight Sweep"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenVault();
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-[#14182C] hover:bg-[#FAF7F0]"
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <KeyRound className="h-3.5 w-3.5 text-[#107C41]" />
                      PDF Vault
                    </span>
                    {pdfHintsCount > 0 && (
                      <span className="rounded-full bg-[#FAF7F0] px-2 py-0.5 text-[10px] font-semibold text-[#4B5563]">
                        {pdfHintsCount}
                      </span>
                    )}
                  </button>
                </div>

                <div className="mt-1.5 border-t border-[#F1EDE4] pt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onSignOut();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2]"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Switch / Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
