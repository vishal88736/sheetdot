import { AlertCircle, AlertTriangle, CheckCircle2, Undo2, BellRing } from "lucide-react";
import {
  CONFIDENCE_COLORS,
  type AgentLogEntry,
  type DigestSummary,
  type PendingRowUpdate,
  type WatchConfig,
} from "@sheetdot/shared";

interface LogListProps {
  logs: AgentLogEntry[];
  pendingUpdates?: PendingRowUpdate[];
  watches?: WatchConfig[];
  latestDigest?: DigestSummary;
  onRevertLog?: (logId: string) => void;
}

function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function LogList({
  logs,
  pendingUpdates = [],
  watches = [],
  latestDigest,
  onRevertLog,
}: LogListProps) {
  const watchMap = new Map(watches.map((w) => [w.id, w]));

  if (logs.length === 0 && pendingUpdates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#DFD8CA] bg-white p-8 text-center text-xs text-[#6B7280] sm:text-sm">
        No activity yet. Enable a template or click Run Now inside a watch to test.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {latestDigest && (
        <section className="rounded-2xl border border-[#ECE7DC] bg-white p-4 shadow-[0_2px_10px_rgba(20,24,44,0.03)]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#ECFDF5] text-[#107C41]">
              <BellRing className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#14182C]">Morning Summary</h2>
                <span className="text-xs text-[#6B7280]">
                  {formatRunTime(latestDigest.generatedAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#374151]">{latestDigest.headline}</p>
              {latestDigest.urgentItems.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[#9A3412]">
                  {latestDigest.urgentItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {pendingUpdates.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">
            Ready to Merge ({pendingUpdates.length})
          </h2>

          {/* Compact cards on narrow Excel Task Pane */}
          <div className="space-y-2 md:hidden">
            {pendingUpdates.map((upd) => (
              <div
                key={upd.id}
                className="rounded-2xl border border-[#ECE7DC] p-3 text-xs shadow-2xs"
                style={{ backgroundColor: CONFIDENCE_COLORS[upd.confidence] }}
              >
                <div className="flex items-center justify-between font-semibold text-[#14182C]">
                  <span>{upd.matchKey}</span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] uppercase">
                    {upd.confidence === "needs_review" ? "Review" : upd.action}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#374151]">{upd.sourceComment}</p>
              </div>
            ))}
          </div>

          {/* Spacious spreadsheet diff preview on laptop */}
          <div className="hidden overflow-x-auto rounded-2xl border border-[#ECE7DC] bg-white shadow-[0_2px_10px_rgba(20,24,44,0.03)] md:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#ECE7DC] bg-[#FAF7F0] text-[#4B5563]">
                  <th className="px-4 py-2.5 font-semibold">Sheet</th>
                  <th className="px-4 py-2.5 font-semibold">Match Key</th>
                  <th className="px-4 py-2.5 font-semibold">Action</th>
                  <th className="px-4 py-2.5 font-semibold">Extracted Fields</th>
                  <th className="px-4 py-2.5 font-semibold">Trust</th>
                  <th className="px-4 py-2.5 font-semibold">Email Provenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EFE6]">
                {pendingUpdates.map((upd) => {
                  const watch = watchMap.get(upd.watchId);
                  const summaryFields = Object.entries(upd.values)
                    .filter(([, v]) => String(v).trim() !== "")
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ");

                  return (
                    <tr key={upd.id} className="hover:bg-[#FAF7F0]/60">
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#14182C]">
                        {watch?.sheetName ?? "Sheet"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-[#374151]">
                        {upd.matchKey}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 uppercase text-[#4B5563]">
                        {upd.action}
                      </td>
                      <td className="px-4 py-2.5 text-[#14182C]">{summaryFields}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[#14182C]"
                          style={{ backgroundColor: CONFIDENCE_COLORS[upd.confidence] }}
                        >
                          {upd.confidence === "needs_review" ? "Needs Review" : "High"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[#4B5563]">{upd.sourceComment}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {logs.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">
            Run History
          </h2>

          <div className="space-y-2.5">
            {logs.map((entry) => {
              const isAuthExpired = entry.status === "auth_expired";
              const isError = entry.status === "error";
              const canRevert =
                Boolean(onRevertLog) &&
                !entry.reverted &&
                entry.rowsAdded + entry.rowsUpdated > 0 &&
                pendingUpdates.some((u) => u.batchId === entry.id);

              const containerClass = isAuthExpired
                ? "border-[#FCA5A5] bg-[#FEF2F2]"
                : isError
                  ? "border-[#FDBA74] bg-[#FFF7ED]"
                  : "border-[#ECE7DC] bg-white";

              return (
                <div
                  key={entry.id}
                  className={`rounded-2xl border p-3.5 shadow-[0_2px_8px_rgba(20,24,44,0.03)] ${containerClass}`}
                >
                  <div className="flex items-start gap-2.5">
                    {isAuthExpired ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                    ) : isError ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA580C]" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8E4D]" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-bold text-[#14182C] sm:text-sm">
                          {entry.watchName}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          {canRevert && (
                            <button
                              type="button"
                              onClick={() => onRevertLog!(entry.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-[#E5DFD3] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#374151] hover:bg-[#FAF7F0]"
                            >
                              <Undo2 className="h-3 w-3" />
                              Revert
                            </button>
                          )}
                          <span className="text-[11px] text-[#6B7280]">
                            {formatRunTime(entry.timestamp)}
                          </span>
                        </div>
                      </div>

                      <p className="mt-1 text-xs leading-snug text-[#4B5563]">
                        {formatRunTime(entry.timestamp)} · {entry.summary}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
