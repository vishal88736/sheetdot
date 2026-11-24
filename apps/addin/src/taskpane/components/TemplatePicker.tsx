import { Plus, Check, Receipt, Calendar, Plane } from "lucide-react";
import { BUILT_IN_TEMPLATES, type WatchConfig, type WatchTemplate } from "@sheetdot/shared";

interface TemplatePickerProps {
  existingWatches: WatchConfig[];
  creatingTemplateId: string | null;
  onSelectTemplate: (template: WatchTemplate) => void;
}

const TEMPLATE_VISUALS: Record<
  WatchTemplate["id"],
  { bg: string; fg: string; Icon: typeof Receipt }
> = {
  bills: { bg: "bg-[#FEF3C7]", fg: "text-[#D97706]", Icon: Receipt },
  subscriptions: { bg: "bg-[#DBEAFE]", fg: "text-[#2563EB]", Icon: Calendar },
  travel: { bg: "bg-[#EDE9FE]", fg: "text-[#7C3AED]", Icon: Plane },
};

export function TemplatePicker({
  existingWatches,
  creatingTemplateId,
  onSelectTemplate,
}: TemplatePickerProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-[#14182C]">Starter Templates</h2>
        <p className="mt-0.5 text-xs text-[#6B7280]">
          One click creates formatted Excel headers and monitors your inbox automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {BUILT_IN_TEMPLATES.map((template) => {
          const isAdded = existingWatches.some((w) => w.templateId === template.id);
          const isCreating = creatingTemplateId === template.id;
          const { bg, fg, Icon } = TEMPLATE_VISUALS[template.id];

          return (
            <div
              key={template.id}
              className="flex flex-col justify-between rounded-2xl border border-[#ECE7DC] bg-white p-4 shadow-[0_2px_10px_rgba(20,24,44,0.03)]"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg} ${fg}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full bg-[#FAF7F0] px-2.5 py-0.5 text-[10px] font-semibold text-[#6B7280]">
                    {template.sheetName}
                  </span>
                </div>

                <h3 className="mt-3 text-sm font-semibold text-[#14182C]">{template.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#6B7280]">
                  {template.description}
                </p>

                <div className="mt-3 flex flex-wrap gap-1">
                  {template.columns.slice(0, 4).map((col) => (
                    <span
                      key={col}
                      className="rounded-md bg-[#FAF7F0] px-2 py-0.5 text-[10px] font-medium text-[#4B5563]"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[#F3EFE6] pt-3">
                <span className="text-[11px] text-[#6B7280]">Daily 8:00 AM</span>

                <button
                  type="button"
                  onClick={() => onSelectTemplate(template)}
                  disabled={isCreating}
                  className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    isAdded
                      ? "bg-[#ECFDF5] text-[#107C41]"
                      : "bg-[#1F8E4D] text-white hover:bg-[#107C41]"
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
