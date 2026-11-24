import type { WatchConfig, WatchTemplate } from "./types.js";

export const BUILT_IN_TEMPLATES: WatchTemplate[] = [
  {
    id: "bills",
    title: "Bill Tracker",
    description: "Auto-logs utility, telecom, and credit card bills from Gmail with spike alerts.",
    name: "Monthly Bills",
    sheetName: "Bills",
    scheduleCron: "0 8 * * *",
    composioQuery: "bill OR invoice OR receipt OR statement OR payment",
    matchKeyColumns: ["merchant", "billing_month"],
    columns: [
      "merchant",
      "billing_month",
      "category",
      "amount",
      "currency",
      "due_date",
      "status",
    ],
    anomalyThresholdPct: 20,
  },
  {
    id: "subscriptions",
    title: "Subscriptions & Renewals",
    description: "Tracks SaaS plans, OTT renewals, and recurring auto-debits before renewal.",
    name: "Subscriptions & Renewals",
    sheetName: "Subscriptions",
    scheduleCron: "0 8 * * *",
    composioQuery: "subscription OR renewal OR recurring OR auto-pay OR membership",
    matchKeyColumns: ["service", "billing_cycle"],
    columns: [
      "service",
      "plan",
      "billing_cycle",
      "amount",
      "currency",
      "renewal_date",
      "status",
    ],
    anomalyThresholdPct: 15,
  },
  {
    id: "travel",
    title: "Travel / PNR Hub",
    description: "Extracts flight PNRs, train tickets, and hotel confirmations into one itinerary sheet.",
    name: "Travel / PNR Hub",
    sheetName: "Travel",
    scheduleCron: "0 8 * * *",
    composioQuery: "PNR OR itinerary OR booking OR flight OR IRCTC OR hotel",
    matchKeyColumns: ["pnr_or_booking_id", "travel_date"],
    columns: [
      "pnr_or_booking_id",
      "provider",
      "route_or_hotel",
      "travel_date",
      "departure_time",
      "amount",
      "status",
    ],
    anomalyThresholdPct: 25,
  },
];

export const TEMPLATES_BY_ID: Record<WatchTemplate["id"], WatchTemplate> = {
  bills: BUILT_IN_TEMPLATES[0]!,
  subscriptions: BUILT_IN_TEMPLATES[1]!,
  travel: BUILT_IN_TEMPLATES[2]!,
};

export function createWatchFromTemplate(
  templateId: WatchTemplate["id"],
  workbookId: string,
  overrides: Partial<WatchConfig> = {}
): Omit<WatchConfig, "id"> & { id?: string } {
  const template = TEMPLATES_BY_ID[templateId];
  return {
    workbookId,
    name: template.name,
    templateId: template.id,
    sheetName: template.sheetName,
    scheduleCron: template.scheduleCron,
    composioQuery: template.composioQuery,
    matchKeyColumns: [...template.matchKeyColumns],
    columns: [...template.columns],
    anomalyThresholdPct: template.anomalyThresholdPct,
    enabled: true,
    ...overrides,
  };
}
