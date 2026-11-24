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
      <div className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-center text-xs text-[#6B7280] sm:text-sm">
        No agent runs recorded yet. Enable a template or click Run Now to test.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {latestDigest && (
        <section className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 sm:p-4">
          <div className="flex items-start gap-2.5">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-[#107C41]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-[#111827] sm:text-sm">
                  Morning Digest Summary
                </h2>
                <span className="text-[10px] text-[#6B7280] sm:text-xs">
                  {formatRunTime(latestDigest.generatedAt)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[#374151] sm:text-xs">{latestDigest.headline}</p>
              {latestDigest.urgentItems.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[#9A3412] sm:text-xs">
                  {latestDigest.urgentItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {logs.length > 0 && (
        <section className="space-y-2">
          <h2 className="hidden text-xs font-semibold uppercase tracking-wider text-[#6B7280] sm:block">
            Run History
          </h2>

          <div className="space-y-2">
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
                  : "border-[#E5E7EB] bg-white";

              return (
                <div
                  key={entry.id}
                  className={`rounded-lg border p-2.5 sm:px-4 sm:py-3 ${containerClass}`}
                >
                  <div className="flex items-start gap-2.5">
                    {isAuthExpired ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                    ) : isError ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA580C]" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#107C41]" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-[#111827] sm:text-sm">
                          {entry.watchName}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          {canRevert && (
                            <button
                              type="button"
                              onClick={() => onRevertLog!(entry.id)}
                              className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] bg-white px-2 py-0.5 text-[10px] font-medium text-[#374151] hover:bg-[#F9FAFB] sm:text-[11px]"
                            >
                              <Undo2 className="h-3 w-3" />
                              Revert
                            </button>
                          )}
                          <span className="text-[10px] text-[#6B7280] sm:text-xs">
                            {formatRunTime(entry.timestamp)}
                          </span>
                        </div>
                      </div>

                      <p className="mt-1 text-[11px] leading-snug text-[#374151] sm:text-xs">
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

      {pendingUpdates.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Queued Sheet Updates ({pendingUpdates.length})
          </h2>

          <div className="space-y-2 sm:hidden">
            {pendingUpdates.map((upd) => (
              <div
                key={upd.id}
                className="rounded-md border border-[#E5E7EB] p-2 text-[11px]"
                style={{ backgroundColor: CONFIDENCE_COLORS[upd.confidence] }}
              >
                <div className="flex items-center justify-between font-semibold text-[#111827]">
                  <span>{upd.matchKey}</span>
                  <span className="uppercase">{upd.action}</span>
                </div>
                <p className="mt-0.5 text-[#374151]">{upd.sourceComment}</p>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white sm:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-[#4B5563]">
                  <th className="px-3 py-2 font-medium">Sheet</th>
                  <th className="px-3 py-2 font-medium">Match Key</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Extracted Values</th>
                  <th className="px-3 py-2 font-medium">Confidence</th>
                  <th className="px-3 py-2 font-medium">Email Provenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {pendingUpdates.map((upd) => {
                  const watch = watchMap.get(upd.watchId);
                  const summaryFields = Object.entries(upd.values)
                    .filter(([, v]) => String(v).trim() !== "")
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ");

                  return (
                    <tr key={upd.id} className="hover:bg-[#F9FAFB]">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[#111827]">
                        {watch?.sheetName ?? "Sheet"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-[#374151]">
                        {upd.matchKey}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 uppercase text-[#374151]">
                        {upd.action}
                      </td>
                      <td className="px-3 py-2 text-[#111827]">{summaryFields}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className="inline-block rounded px-2 py-0.5 text-[11px] font-medium text-[#111827]"
                          style={{ backgroundColor: CONFIDENCE_COLORS[upd.confidence] }}
                        >
                          {upd.confidence === "needs_review" ? "Needs Review" : "High"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[#4B5563]">{upd.sourceComment}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
