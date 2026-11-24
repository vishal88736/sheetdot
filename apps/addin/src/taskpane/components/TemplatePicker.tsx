import { Plus, Check } from "lucide-react";
import { BUILT_IN_TEMPLATES, type WatchConfig, type WatchTemplate } from "@sheetdot/shared";

interface TemplatePickerProps {
  existingWatches: WatchConfig[];
  creatingTemplateId: string | null;
  onSelectTemplate: (template: WatchTemplate) => void;
}

export function TemplatePicker({
  existingWatches,
  creatingTemplateId,
  onSelectTemplate,
}: TemplatePickerProps) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <p className="text-[11px] text-[#6B7280] sm:text-xs">
        One-click templates create formatted Excel headers and schedule a 24/7 Gmail watch.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {BUILT_IN_TEMPLATES.map((template) => {
          const isAdded = existingWatches.some((w) => w.templateId === template.id);
          const isCreating = creatingTemplateId === template.id;

          return (
            <div
              key={template.id}
              className="flex flex-col justify-between rounded-lg border border-[#E5E7EB] bg-white p-3 sm:p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#111827] sm:text-sm">
                    {template.title}
                  </h3>
                  <span className="hidden rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-medium text-[#4B5563] sm:inline-block">
                    {template.sheetName}
                  </span>
                </div>

                <p className="mt-1.5 text-[11px] leading-relaxed text-[#4B5563] sm:text-xs">
                  {template.description}
                </p>

                <div className="mt-3 hidden flex-wrap gap-1 sm:flex">
                  {template.columns.slice(0, 5).map((col) => (
                    <span
                      key={col}
                      className="rounded border border-[#E5E7EB] bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] text-[#4B5563]"
                    >
                      {col}
                    </span>
                  ))}
                  {template.columns.length > 5 && (
                    <span className="px-1 py-0.5 text-[10px] text-[#6B7280]">
                      +{template.columns.length - 5}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#F3F4F6] pt-2.5">
                <span className="text-[10px] text-[#6B7280] sm:text-[11px]">
                  Tab: {template.sheetName} · Daily 8:00 AM
                </span>

                <button
                  type="button"
                  onClick={() => onSelectTemplate(template)}
                  disabled={isCreating}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs ${
                    isAdded
                      ? "border border-[#E5E7EB] bg-[#F9FAFB] text-[#107C41]"
                      : "bg-[#107C41] text-white hover:bg-[#0D6535]"
                  } disabled:opacity-50`}
                >
                  {isAdded ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Active
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      {isCreating ? "Adding..." : "Enable"}
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
