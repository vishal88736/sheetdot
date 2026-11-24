import { Play, Clock, AlertTriangle, Trash2 } from "lucide-react";
import { formatCronBadge, type WatchConfig, type WatchSourceType } from "@sheetdot/shared";

interface WatchCardProps {
  watch: WatchConfig;
  isRunning: boolean;
  onToggle: (watchId: string, enabled: boolean) => void;
  onRunNow: (watchId: string) => void;
  onDelete: (watchId: string) => void;
}

const SOURCE_LABELS: Record<WatchSourceType, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  github: "GitHub",
  sms_webhook: "SMS/UPI",
  cell_watch: "=AI.WATCH",
};

function formatShortTime(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function WatchCard({ watch, isRunning, onToggle, onRunNow, onDelete }: WatchCardProps) {
  const lastRun = formatShortTime(watch.lastRunAt);
  const sourceLabel = SOURCE_LABELS[watch.source ?? "gmail"];

  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#E5E7EB] bg-white p-3 sm:p-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-xs font-semibold text-[#111827] sm:text-sm">
                {watch.name}
              </h3>
              <span className="shrink-0 rounded bg-[#ECFDF5] px-1.5 py-0.5 text-[10px] font-medium text-[#065F46]">
                {sourceLabel}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#6B7280] sm:text-xs">
              Sheet: <span className="font-medium text-[#374151]">{watch.sheetName}</span>
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={watch.enabled}
            aria-label={`Toggle ${watch.name}`}
            onClick={() => onToggle(watch.id, !watch.enabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              watch.enabled ? "bg-[#107C41]" : "bg-[#D1D5DB]"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                watch.enabled ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {watch.autoPausedReason && (
          <div className="mt-2 flex items-start gap-1.5 rounded border border-[#FCA5A5] bg-[#FEF2F2] p-2 text-[11px] text-[#B91C1C]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{watch.autoPausedReason}</span>
          </div>
        )}

        <div className="mt-2 hidden space-y-1 text-xs text-[#6B7280] sm:block">
          <p className="truncate" title={watch.composioQuery}>
            Query: <span className="text-[#374151]">{watch.composioQuery}</span>
          </p>
          {lastRun && <p>Last run: {lastRun}</p>}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#F3F4F6] pt-2.5">
        <span className="inline-flex items-center gap-1 rounded bg-[#F3F4F6] px-2 py-0.5 text-[11px] font-medium text-[#374151] sm:text-xs">
          <Clock className="h-3 w-3 text-[#6B7280]" />
          {formatCronBadge(watch.scheduleCron)}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onDelete(watch.id)}
            title={`Remove ${watch.name}`}
            className="inline-flex items-center rounded-md border border-[#E5E7EB] bg-white p-1.5 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
          >
            <Trash2 className="h-3 w-3" />
          </button>

          <button
            type="button"
            onClick={() => onRunNow(watch.id)}
            disabled={isRunning}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50 sm:text-xs"
          >
            <Play className="h-3 w-3 text-[#107C41]" />
            {isRunning ? "Running..." : "Run Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
