import {
  AGENT_LOG_SHEET_NAME,
  CONFIDENCE_COLORS,
  SHEETDOT_ID_COLUMN,
  computeMatchKey,
  normalizeMatchKeyPart,
  type AgentLogEntry,
  type PendingRowUpdate,
  type SyncPayload,
  type WatchConfig,
} from "@sheetdot/shared";
import { acknowledgeSync, fetchSyncState } from "../lib/api.js";

export type CellMatrixValue = string | number | boolean | null;

export interface CellWriteOperation {
  rowIndex: number; // 0-based sheet row index (0 = headers, >=1 = data rows)
  colIndex: number; // 0-based column index
  value: string | number;
  fillColor: string;
}

export interface CellCommentOperation {
  rowIndex: number;
  colIndex: number;
  comment: string;
}

export interface WorksheetSyncPlan {
  cellWrites: CellWriteOperation[];
  comments: CellCommentOperation[];
  rowsAdded: number;
  rowsUpdated: number;
  appliedUpdateIds: string[];
  resultingRows: CellMatrixValue[][];
}

export interface SyncExecutionResult {
  syncPayload: SyncPayload;
  inExcelHost: boolean;
  rowsAdded: number;
  rowsUpdated: number;
  acknowledgedCount: number;
}

export function columnIndexToLetter(colIndex: number): string {
  let index = colIndex;
  let result = "";
  while (index >= 0) {
    result = String.fromCharCode((index % 26) + 65) + result;
    index = Math.floor(index / 26) - 1;
  }
  return result;
}

export function toA1Address(rowIndex: number, colIndex: number): string {
  return `${columnIndexToLetter(colIndex)}${rowIndex + 1}`;
}

function buildHeaderIndexMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, idx) => {
    const normalized = header.trim().toLowerCase();
    if (normalized) {
      map.set(normalized, idx);
    }
  });
  return map;
}

function extractRowRecord(
  row: CellMatrixValue[],
  headers: string[]
): Record<string, string | number | boolean | null> {
  const record: Record<string, string | number | boolean | null> = {};
  headers.forEach((header, idx) => {
    if (header.trim()) {
      record[header] = row[idx] ?? null;
    }
  });
  return record;
}

function resolveRowMatchKey(
  row: CellMatrixValue[],
  headers: string[],
  headerMap: Map<string, number>,
  matchKeyColumns: string[],
  entityAliases?: Record<string, string>
): string {
  const idColIdx = headerMap.get(SHEETDOT_ID_COLUMN.toLowerCase());
  if (idColIdx !== undefined) {
    const storedId = row[idColIdx];
    if (storedId !== null && storedId !== undefined && String(storedId).trim() !== "") {
      return normalizeMatchKeyPart(String(storedId)).replace(/\s*:\s*/g, "::");
    }
  }

  const record = extractRowRecord(row, headers);
  const computed = computeMatchKey(record, matchKeyColumns, entityAliases);
  return computed.replace(/:/g, "").trim().length > 0 ? computed : "";
}

function valuesEqual(existing: CellMatrixValue | undefined, incoming: string | number): boolean {
  if (existing === undefined || existing === null) return false;
  if (typeof incoming === "number" && typeof existing === "number") {
    return existing === incoming;
  }
  return String(existing).trim() === String(incoming).trim();
}

function pickCommentColumnIndex(
  update: PendingRowUpdate,
  watch: Pick<WatchConfig, "columns" | "matchKeyColumns">,
  headerMap: Map<string, number>
): number {
  const preferredCandidates = [
    ...watch.columns.filter((c) => /amount|total|status|due|renewal/i.test(c)),
    ...watch.matchKeyColumns,
    ...Object.keys(update.values),
  ];

  for (const colName of preferredCandidates) {
    const idx = headerMap.get(colName.toLowerCase());
    if (idx !== undefined) {
      return idx;
    }
  }
  return 0;
}

/**
 * Pure row-safe diff planner.
 * Matches records strictly by deterministic `matchKey` (from `_sheetdot_id` or `matchKeyColumns`)
 * rather than raw row indices, preserving manual edits and surviving sorts or row shifts.
 */
export function planWorksheetSync(
  headers: string[],
  existingDataRows: CellMatrixValue[][],
  watch: Pick<WatchConfig, "id" | "sheetName" | "matchKeyColumns" | "columns" | "entityAliases">,
  updates: PendingRowUpdate[]
): WorksheetSyncPlan {
  const headerMap = buildHeaderIndexMap(headers);
  const idColIdx = headerMap.get(SHEETDOT_ID_COLUMN.toLowerCase());
  const workingRows: CellMatrixValue[][] = existingDataRows.map((row) => {
    const copy = [...row];
    while (copy.length < headers.length) copy.push(null);
    return copy;
  });

  // Index live row positions by deterministic matchKey
  const matchKeyToDataRowIdx = new Map<string, number>();
  workingRows.forEach((row, dataIdx) => {
    const key = resolveRowMatchKey(
      row,
      headers,
      headerMap,
      watch.matchKeyColumns,
      watch.entityAliases
    );
    if (key) {
      matchKeyToDataRowIdx.set(key, dataIdx);
    }
  });

  const cellWrites: CellWriteOperation[] = [];
  const comments: CellCommentOperation[] = [];
  const appliedUpdateIds: string[] = [];
  let rowsAdded = 0;
  let rowsUpdated = 0;

  for (const update of updates) {
    const fillColor = CONFIDENCE_COLORS[update.confidence];
    const existingDataIdx = matchKeyToDataRowIdx.get(update.matchKey);

    if (existingDataIdx !== undefined) {
      // Update existing row in-place by its current live index; leave untouched columns intact
      const targetRow = workingRows[existingDataIdx]!;
      const sheetRowIdx = existingDataIdx + 1;
      let changedAnyCell = false;

      for (const [colName, incomingVal] of Object.entries(update.values)) {
        const colIdx = headerMap.get(colName.toLowerCase());
        if (colIdx === undefined) continue;
        if (!valuesEqual(targetRow[colIdx], incomingVal)) {
          targetRow[colIdx] = incomingVal;
          cellWrites.push({
            rowIndex: sheetRowIdx,
            colIndex: colIdx,
            value: incomingVal,
            fillColor,
          });
          changedAnyCell = true;
        }
      }

      if (idColIdx !== undefined && !valuesEqual(targetRow[idColIdx], update.matchKey)) {
        targetRow[idColIdx] = update.matchKey;
        cellWrites.push({
          rowIndex: sheetRowIdx,
          colIndex: idColIdx,
          value: update.matchKey,
          fillColor,
        });
      }

      if (changedAnyCell) {
        rowsUpdated += 1;
        comments.push({
          rowIndex: sheetRowIdx,
          colIndex: pickCommentColumnIndex(update, watch, headerMap),
          comment: update.sourceComment,
        });
      }

      appliedUpdateIds.push(update.id);
      continue;
    }

    // Insert new row at bottom of table
    const newDataIdx = workingRows.length;
    const sheetRowIdx = newDataIdx + 1;
    const newRow: CellMatrixValue[] = new Array(headers.length).fill(null);

    for (const [colName, incomingVal] of Object.entries(update.values)) {
      const colIdx = headerMap.get(colName.toLowerCase());
      if (colIdx === undefined) continue;
      newRow[colIdx] = incomingVal;
      cellWrites.push({
        rowIndex: sheetRowIdx,
        colIndex: colIdx,
        value: incomingVal,
        fillColor,
      });
    }

    if (idColIdx !== undefined) {
      newRow[idColIdx] = update.matchKey;
      cellWrites.push({
        rowIndex: sheetRowIdx,
        colIndex: idColIdx,
        value: update.matchKey,
        fillColor,
      });
    }

    workingRows.push(newRow);
    matchKeyToDataRowIdx.set(update.matchKey, newDataIdx);
    rowsAdded += 1;
    comments.push({
      rowIndex: sheetRowIdx,
      colIndex: pickCommentColumnIndex(update, watch, headerMap),
      comment: update.sourceComment,
    });
    appliedUpdateIds.push(update.id);
  }

  return {
    cellWrites,
    comments,
    rowsAdded,
    rowsUpdated,
    appliedUpdateIds,
    resultingRows: workingRows,
  };
}

async function ensureWorksheetWithHeaders(
  context: Excel.RequestContext,
  sheetName: string,
  headers: string[],
  hideIdColumn: boolean
): Promise<{ sheet: Excel.Worksheet; existingHeaders: string[]; existingDataRows: CellMatrixValue[][] }> {
  let sheet = context.workbook.worksheets.getItemOrNullObject(sheetName);
  sheet.load("name,isNullObject");
  await context.sync();

  if (sheet.isNullObject) {
    sheet = context.workbook.worksheets.add(sheetName);
    await context.sync();
  }

  const usedRange = sheet.getUsedRangeOrNullObject();
  usedRange.load("values,isNullObject,rowCount,columnCount");
  await context.sync();

  if (usedRange.isNullObject || usedRange.rowCount === 0) {
    const headerRange = sheet.getRangeByIndexes(0, 0, 1, headers.length);
    headerRange.values = [headers];
    headerRange.format.font.bold = true;
    headerRange.format.fill.color = "#F3F4F6";
    headerRange.format.borders.getItem("EdgeBottom").color = "#107C41";

    if (hideIdColumn) {
      const idIdx = headers.findIndex((h) => h.toLowerCase() === SHEETDOT_ID_COLUMN.toLowerCase());
      if (idIdx >= 0) {
        sheet.getRangeByIndexes(0, idIdx, 1, 1).columnHidden = true;
      }
    }

    await context.sync();
    return { sheet, existingHeaders: headers, existingDataRows: [] };
  }

  const allValues = usedRange.values as CellMatrixValue[][];
  const rawHeaderRow = (allValues[0] ?? []).map((v) => (v === null || v === undefined ? "" : String(v).trim()));

  // Append hidden _sheetdot_id header if missing from an existing user sheet
  const existingHeaders = [...rawHeaderRow];
  if (
    hideIdColumn &&
    !existingHeaders.some((h) => h.toLowerCase() === SHEETDOT_ID_COLUMN.toLowerCase())
  ) {
    const nextCol = existingHeaders.length;
    existingHeaders.push(SHEETDOT_ID_COLUMN);
    const idHeaderRange = sheet.getRangeByIndexes(0, nextCol, 1, 1);
    idHeaderRange.values = [[SHEETDOT_ID_COLUMN]];
    idHeaderRange.columnHidden = true;
    await context.sync();
  }

  const existingDataRows = allValues.slice(1).filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")
  );

  return { sheet, existingHeaders, existingDataRows };
}

/**
 * Ensures the worksheet and table headers for a watch/template exist in Excel.
 */
export async function ensureTemplateTable(
  watch: Pick<WatchConfig, "sheetName" | "columns">
): Promise<{ executedInExcel: boolean }> {
  if (typeof Excel === "undefined") {
    return { executedInExcel: false };
  }

  await Excel.run(async (context) => {
    const headers = [...watch.columns, SHEETDOT_ID_COLUMN];
    const { sheet } = await ensureWorksheetWithHeaders(context, watch.sheetName, headers, true);
    sheet.activate();
    await context.sync();
  });

  return { executedInExcel: true };
}

async function appendAgentLogsToExcel(
  context: Excel.RequestContext,
  logs: AgentLogEntry[]
): Promise<void> {
  if (logs.length === 0) return;

  const logHeaders = [
    "ID",
    "Timestamp",
    "Watch",
    "Emails Scanned",
    "Rows Added",
    "Rows Updated",
    "Status",
    "Summary",
  ];

  const { sheet, existingDataRows } = await ensureWorksheetWithHeaders(
    context,
    AGENT_LOG_SHEET_NAME,
    logHeaders,
    false
  );

  const existingIds = new Set(
    existingDataRows.map((row) => String(row[0] ?? "").trim()).filter(Boolean)
  );

  const newLogs = [...logs].reverse().filter((log) => !existingIds.has(log.id));
  if (newLogs.length === 0) return;

  const startRow = existingDataRows.length + 1;
  const rowsToWrite = newLogs.map((log) => [
    log.id,
    log.timestamp,
    log.watchName,
    log.emailsScanned,
    log.rowsAdded,
    log.rowsUpdated,
    log.status,
    log.summary,
  ]);

  const targetRange = sheet.getRangeByIndexes(startRow, 0, rowsToWrite.length, logHeaders.length);
  targetRange.values = rowsToWrite;
}

/**
 * Fetches pending overnight updates from the Worker and applies them row-safely to Excel.
 */
export async function syncWorkbookWithExcel(workbookId: string): Promise<SyncExecutionResult> {
  const syncPayload = await fetchSyncState(workbookId);

  if (typeof Excel === "undefined") {
    return {
      syncPayload,
      inExcelHost: false,
      rowsAdded: 0,
      rowsUpdated: 0,
      acknowledgedCount: 0,
    };
  }

  let totalAdded = 0;
  let totalUpdated = 0;
  const appliedIds: string[] = [];

  await Excel.run(async (context) => {
    const watchesById = new Map(syncPayload.watches.map((w) => [w.id, w]));
    const updatesByWatch = new Map<string, PendingRowUpdate[]>();

    for (const update of syncPayload.pendingUpdates) {
      const list = updatesByWatch.get(update.watchId) ?? [];
      list.push(update);
      updatesByWatch.set(update.watchId, list);
    }

    for (const [watchId, updates] of updatesByWatch.entries()) {
      const watch = watchesById.get(watchId);
      if (!watch) continue;

      const defaultHeaders = [...watch.columns, SHEETDOT_ID_COLUMN];
      const { sheet, existingHeaders, existingDataRows } = await ensureWorksheetWithHeaders(
        context,
        watch.sheetName,
        defaultHeaders,
        true
      );

      const plan = planWorksheetSync(existingHeaders, existingDataRows, watch, updates);
      totalAdded += plan.rowsAdded;
      totalUpdated += plan.rowsUpdated;
      appliedIds.push(...plan.appliedUpdateIds);

      for (const write of plan.cellWrites) {
        const cellRange = sheet.getRangeByIndexes(write.rowIndex, write.colIndex, 1, 1);
        cellRange.values = [[write.value]];
        cellRange.format.fill.color = write.fillColor;
      }

      for (const commentOp of plan.comments) {
        const address = toA1Address(commentOp.rowIndex, commentOp.colIndex);
        try {
          const existingComment = sheet.comments.getItemByCell(address);
          existingComment.load("id");
          await context.sync();
          existingComment.content = commentOp.comment;
        } catch {
          sheet.comments.add(address, commentOp.comment);
        }
      }
    }

    await appendAgentLogsToExcel(context, syncPayload.agentLogs);
    await context.sync();
  });

  let acknowledgedCount = 0;
  if (appliedIds.length > 0) {
    const ackRes = await acknowledgeSync({ workbookId, updateIds: appliedIds });
    acknowledgedCount = ackRes.acknowledged;
  }

  return {
    syncPayload,
    inExcelHost: true,
    rowsAdded: totalAdded,
    rowsUpdated: totalUpdated,
    acknowledgedCount,
  };
}
