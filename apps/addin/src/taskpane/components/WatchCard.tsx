import { Calendar, Receipt, Plane, MessageSquare, GitBranch, Sparkles } from "lucide-react";
import { formatCronBadge, type WatchConfig } from "@sheetdot/shared";

interface WatchCardProps {
  watch: WatchConfig;
  onToggle: (watchId: string, enabled: boolean) => void;
  onSelect: (watch: WatchConfig) => void;
}

function getWatchVisual(watch: WatchConfig): {
  bg: string;
  fg: string;
  Icon: typeof Receipt;
} {
  if (watch.templateId === "bills") {
    return { bg: "bg-[#FEF3C7]", fg: "text-[#D97706]", Icon: Receipt };
  }
  if (watch.templateId === "subscriptions") {
    return { bg: "bg-[#DBEAFE]", fg: "text-[#2563EB]", Icon: Calendar };
  }
  if (watch.templateId === "travel") {
    return { bg: "bg-[#EDE9FE]", fg: "text-[#7C3AED]", Icon: Plane };
  }
  if (watch.source === "calendar") {
    return { bg: "bg-[#DBEAFE]", fg: "text-[#2563EB]", Icon: Calendar };
  }
  if (watch.source === "github") {
    return { bg: "bg-[#E2E8F0]", fg: "text-[#334155]", Icon: GitBranch };
  }
  if (watch.source === "sms_webhook") {
    return { bg: "bg-[#D1FAE5]", fg: "text-[#059669]", Icon: MessageSquare };
  }
  return { bg: "bg-[#FCE7F3]", fg: "text-[#DB2777]", Icon: Sparkles };
}

export function WatchCard({ watch, onToggle, onSelect }: WatchCardProps) {
  const { bg, fg, Icon } = getWatchVisual(watch);

  return (
    <div
      onClick={() => onSelect(watch)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(watch);
        }
      }}
      className="group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-[#ECE7DC] bg-white p-3.5 shadow-[0_2px_10px_rgba(20,24,44,0.03)] transition hover:border-[#D9D2C3] hover:shadow-[0_6px_18px_rgba(20,24,44,0.06)] sm:p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${bg} ${fg}`}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[#14182C]">{watch.name}</h3>
          <p className="mt-0.5 truncate text-xs text-[#6B7280]">
            {watch.sheetName} · {formatCronBadge(watch.scheduleCron)}
          </p>
          {watch.autoPausedReason && (
            <p className="mt-0.5 truncate text-[11px] font-medium text-[#DC2626]">
              Paused · Needs attention
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={watch.enabled}
        aria-label={`Toggle ${watch.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(watch.id, !watch.enabled);
        }}
        className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer items-center rounded-full px-1.5 transition-colors ${
          watch.enabled ? "bg-[#1F8E4D]" : "bg-[#D1D5DB]"
        }`}
      >
        <span
          className={`text-[10px] font-bold tracking-wide text-white transition-opacity ${
            watch.enabled ? "ml-0.5 opacity-100" : "opacity-0"
          }`}
        >
          ON
        </span>
        <span
          className={`absolute h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
            watch.enabled ? "translate-x-6" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
