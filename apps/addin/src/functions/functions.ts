import {
  askCellQuestion,
  getOrCreateWorkbookId,
  registerWatchCell,
} from "../lib/api.js";

type CellScalar = string | number | boolean | null;

function normalizeContextMatrix(contextRange: unknown): CellScalar[][] {
  if (!Array.isArray(contextRange)) {
    return [[normalizeCellValue(contextRange)]];
  }
  return contextRange.map((row) =>
    Array.isArray(row) ? row.map(normalizeCellValue) : [normalizeCellValue(row)]
  );
}

function normalizeCellValue(val: unknown): CellScalar {
  if (val === null || val === undefined) return null;
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return val;
  }
  return String(val);
}

/**
 * Excel custom function: =AI.ASK(question, contextRange)
 * Sends question + serialized range values to POST /api/ask and returns the answer.
 *
 * @customfunction
 * @param question Question to evaluate against the range
 * @param contextRange Cell or range providing context
 * @returns Answer string for the target cell
 */
export async function ask(question: string, contextRange: unknown[][]): Promise<string> {
  const cleanQuestion = String(question ?? "").trim();
  if (!cleanQuestion) {
    return "#VALUE!";
  }

  try {
    const workbookId = getOrCreateWorkbookId();
    const rowValues = normalizeContextMatrix(contextRange);
    const result = await askCellQuestion({
      workbookId,
      question: cleanQuestion,
      rowValues,
    });
    return result.answer;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Request failed";
    return `Sheetdot Error: ${msg}`;
  }
}

/**
 * Excel custom function: =AI.WATCH(question, contextRange, [schedule])
 * Registers a recurring watch for that cell/row and returns the latest cached answer.
 *
 * @customfunction
 * @param question Recurring question or rule to watch
 * @param contextRange Cell or range monitored by this watch
 * @param schedule Optional cron expression or preset ("daily", "hourly")
 * @returns Latest cached answer string
 */
export async function watch(
  question: string,
  contextRange: unknown[][],
  schedule: string = "0 8 * * *"
): Promise<string> {
  const cleanQuestion = String(question ?? "").trim();
  if (!cleanQuestion) {
    return "#VALUE!";
  }

  try {
    const workbookId = getOrCreateWorkbookId();
    const rowValues = normalizeContextMatrix(contextRange);
    const result = await registerWatchCell({
      workbookId,
      question: cleanQuestion,
      rowValues,
      schedule: String(schedule || "0 8 * * *"),
    });
    return result.answer;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Request failed";
    return `Sheetdot Error: ${msg}`;
  }
}

if (typeof CustomFunctions !== "undefined") {
  CustomFunctions.associate("ASK", ask);
  CustomFunctions.associate("WATCH", watch);
}
