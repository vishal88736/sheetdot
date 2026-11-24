import { Play, Clock } from "lucide-react";
import { formatCronBadge, type WatchConfig } from "@sheetdot/shared";

interface WatchCardProps {
  watch: WatchConfig;
  isRunning: boolean;
  onToggle: (watchId: string, enabled: boolean) => void;
  onRunNow: (watchId: string) => void;
}

export function WatchCard({ watch, isRunning, onToggle, onRunNow }: WatchCardProps) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-[#111827]">{watch.name}</h3>
          <p className="mt-0.5 text-[11px] text-[#6B7280]">
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

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-[#F3F4F6] px-2 py-0.5 text-[11px] font-medium text-[#374151]">
          <Clock className="h-3 w-3 text-[#6B7280]" />
          {formatCronBadge(watch.scheduleCron)}
        </span>

        <button
          type="button"
          onClick={() => onRunNow(watch.id)}
          disabled={isRunning}
          className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
        >
          <Play className="h-3 w-3 text-[#107C41]" />
          {isRunning ? "Running..." : "Run Now"}
        </button>
      </div>
    </div>
  );
}
