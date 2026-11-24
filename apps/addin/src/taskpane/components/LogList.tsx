import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { AgentLogEntry } from "@sheetdot/shared";

interface LogListProps {
  logs: AgentLogEntry[];
}

function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function LogList({ logs }: LogListProps) {
  if (logs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-xs text-[#6B7280]">
        No agent runs recorded yet. Enable a template or click Run Now to test.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((entry) => {
        const isAuthExpired = entry.status === "auth_expired";
        const isError = entry.status === "error";

        const containerClass = isAuthExpired
          ? "border-[#FCA5A5] bg-[#FEF2F2]"
          : isError
            ? "border-[#FDBA74] bg-[#FFF7ED]"
            : "border-[#E5E7EB] bg-white";

        return (
          <div key={entry.id} className={`rounded-md border p-2.5 ${containerClass}`}>
            <div className="flex items-start gap-2">
              {isAuthExpired ? (
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#DC2626]" />
              ) : isError ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EA580C]" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#107C41]" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-[#111827]">
                    {entry.watchName}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#6B7280]">
                    {formatRunTime(entry.timestamp)}
                  </span>
                </div>

                <p className="mt-1 text-[11px] leading-snug text-[#374151]">
                  {formatRunTime(entry.timestamp)} · {entry.summary}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
