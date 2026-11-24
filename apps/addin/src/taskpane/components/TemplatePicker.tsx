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
    <div className="space-y-2.5">
      <p className="text-[11px] text-[#6B7280]">
        One-click templates create formatted Excel headers and schedule a 24/7 Gmail watch.
      </p>

      {BUILT_IN_TEMPLATES.map((template) => {
        const isAdded = existingWatches.some((w) => w.templateId === template.id);
        const isCreating = creatingTemplateId === template.id;

        return (
          <div
            key={template.id}
            className="rounded-md border border-[#E5E7EB] bg-white p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[#111827]">{template.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-[#4B5563]">
                  {template.description}
                </p>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#6B7280]">
                Tab: {template.sheetName} · Daily 8:00 AM
              </span>

              <button
                type="button"
                onClick={() => onSelectTemplate(template)}
                disabled={isCreating}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium ${
                  isAdded
                    ? "border border-[#E5E7EB] bg-[#F9FAFB] text-[#107C41]"
                    : "bg-[#107C41] text-white hover:bg-[#0D6535]"
                } disabled:opacity-50`}
              >
                {isAdded ? (
                  <>
                    <Check className="h-3 w-3" />
                    Active
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" />
                    {isCreating ? "Adding..." : "Enable"}
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
