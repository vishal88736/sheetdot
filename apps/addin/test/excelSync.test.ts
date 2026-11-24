import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CONFIDENCE_COLORS,
  SHEETDOT_ID_COLUMN,
  type PendingRowUpdate,
  type WatchConfig,
} from "@sheetdot/shared";
import {
  planWorksheetSync,
  syncWorkbookWithExcel,
  toA1Address,
  type CellMatrixValue,
} from "../src/sync/excelSync.js";
import { ask, watch } from "../src/functions/functions.js";

const BILLS_WATCH: WatchConfig = {
  id: "watch_bills",
  workbookId: "wb-test",
  name: "Monthly Bills",
  templateId: "bills",
  sheetName: "Bills",
  scheduleCron: "0 8 * * *",
  composioQuery: "bill OR invoice",
  matchKeyColumns: ["merchant", "billing_month"],
  columns: ["merchant", "billing_month", "category", "amount", "currency", "due_date", "status"],
  anomalyThresholdPct: 20,
  enabled: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("planWorksheetSync (row-safe diff engine)", () => {
  it("matches sorted or shifted rows by deterministic matchKey and preserves manual edits", () => {
    // User added a custom column "notes", reordered rows (sorted descending by amount),
    // and manually edited notes on Airtel.
    const headers = [
      "merchant",
      "billing_month",
      "category",
      "amount",
      "currency",
      "due_date",
      "status",
      "notes",
      SHEETDOT_ID_COLUMN,
    ];

    const existingRowsAfterSort: CellMatrixValue[][] = [
      // Row shifted to top (sheet row index 1 -> Excel row 2)
      [
        "HDFC Credit Card",
        "2026-11",
        "Credit Card",
        18420,
        "INR",
        "2026-12-08",
        "Unpaid",
        "Verify reward points",
        "hdfc credit card::2026-11",
      ],
      // Airtel shifted down to index 1 (Excel row 3) and has no _sheetdot_id yet
      [
        "Airtel",
        "2026-11",
        "Telecom & Fiber",
        1179,
        "INR",
        "2026-11-28",
        "Unpaid",
        "Paid from joint account",
        null,
      ],
    ];

    const updates: PendingRowUpdate[] = [
      {
        id: "upd_1",
        watchId: BILLS_WATCH.id,
        action: "update",
        matchKey: "airtel::2026-11",
        values: {
          merchant: "Airtel",
          billing_month: "2026-11",
          category: "Telecom & Fiber",
          amount: 1179,
          currency: "INR",
          due_date: "2026-11-28",
          status: "Paid",
        },
        sourceComment: 'payments@airtel.in · "Payment Received"',
        confidence: "high",
        emailMessageId: "msg_airtel_paid",
        createdAt: "2026-11-25T02:00:00.000Z",
      },
      {
        id: "upd_2",
        watchId: BILLS_WATCH.id,
        action: "insert",
        matchKey: "bescom::2026-11",
        values: {
          merchant: "BESCOM",
          billing_month: "2026-11",
          category: "Electricity",
          amount: 4850,
          currency: "INR",
          due_date: "2026-12-05",
          status: "Unpaid",
        },
        sourceComment: 'ebill@bescom.co.in · "BESCOM Nov 2026" [Anomaly: +131%]',
        confidence: "needs_review",
        emailMessageId: "msg_bescom_nov",
        createdAt: "2026-11-25T02:01:00.000Z",
      },
    ];

    const plan = planWorksheetSync(headers, existingRowsAfterSort, BILLS_WATCH, updates);

    expect(plan.rowsUpdated).toBe(1);
    expect(plan.rowsAdded).toBe(1);
    expect(plan.appliedUpdateIds).toEqual(["upd_1", "upd_2"]);

    // HDFC row at index 0 untouched
    expect(plan.resultingRows[0]![0]).toBe("HDFC Credit Card");
    expect(plan.resultingRows[0]![7]).toBe("Verify reward points");

    // Airtel row at shifted sheet row index 2 (data index 1) updated ONLY status + _sheetdot_id
    expect(plan.resultingRows[1]![6]).toBe("Paid");
    expect(plan.resultingRows[1]![7]).toBe("Paid from joint account"); // Manual edit preserved!
    expect(plan.resultingRows[1]![8]).toBe("airtel::2026-11");

    const statusWrite = plan.cellWrites.find((w) => w.rowIndex === 2 && w.colIndex === 6);
    expect(statusWrite).toBeDefined();
    expect(statusWrite!.value).toBe("Paid");
    expect(statusWrite!.fillColor).toBe(CONFIDENCE_COLORS.high);

    // BESCOM appended at data index 2 (sheet row index 3 -> Excel row 4) with orange highlight
    expect(plan.resultingRows[2]![0]).toBe("BESCOM");
    expect(plan.resultingRows[2]![3]).toBe(4850);
    const bescomAmountWrite = plan.cellWrites.find((w) => w.rowIndex === 3 && w.colIndex === 3);
    expect(bescomAmountWrite?.fillColor).toBe(CONFIDENCE_COLORS.needs_review);

    // Comments placed on live shifted row addresses
    expect(plan.comments).toHaveLength(2);
    expect(toA1Address(plan.comments[0]!.rowIndex, plan.comments[0]!.colIndex)).toBe("D3");
    expect(plan.comments[0]!.comment).toContain("payments@airtel.in");
    expect(toA1Address(plan.comments[1]!.rowIndex, plan.comments[1]!.colIndex)).toBe("D4");
    expect(plan.comments[1]!.comment).toContain("Anomaly");
  });

  it("handles sequential insert followed by update for the same matchKey in one sync batch", () => {
    const headers = [...BILLS_WATCH.columns, SHEETDOT_ID_COLUMN];
    const updates: PendingRowUpdate[] = [
      {
        id: "upd_insert",
        watchId: BILLS_WATCH.id,
        action: "insert",
        matchKey: "airtel::2026-11",
        values: {
          merchant: "Airtel",
          billing_month: "2026-11",
          category: "Telecom",
          amount: 1179,
          currency: "INR",
          due_date: "2026-11-28",
          status: "Unpaid",
        },
        sourceComment: "ebill@airtel.in",
        confidence: "high",
        emailMessageId: "msg_1",
        createdAt: "2026-11-25T01:00:00.000Z",
      },
      {
        id: "upd_paid",
        watchId: BILLS_WATCH.id,
        action: "update",
        matchKey: "airtel::2026-11",
        values: {
          merchant: "Airtel",
          billing_month: "2026-11",
          category: "Telecom",
          amount: 1179,
          currency: "INR",
          due_date: "2026-11-28",
          status: "Paid",
        },
        sourceComment: "payments@airtel.in",
        confidence: "high",
        emailMessageId: "msg_2",
        createdAt: "2026-11-25T02:00:00.000Z",
      },
    ];

    const plan = planWorksheetSync(headers, [], BILLS_WATCH, updates);
    expect(plan.rowsAdded).toBe(1);
    expect(plan.rowsUpdated).toBe(1);
    expect(plan.resultingRows).toHaveLength(1);
    expect(plan.resultingRows[0]![6]).toBe("Paid");
  });

  it("matches existing rows via normalized entity aliases (e.g. Airtel Black -> airtel)", () => {
    const headers = [...BILLS_WATCH.columns, SHEETDOT_ID_COLUMN];
    const rows: CellMatrixValue[][] = [
      ["Airtel Black", "2026-11", "Telecom", 1179, "INR", "2026-11-28", "Unpaid", null],
    ];
    const updates: PendingRowUpdate[] = [
      {
        id: "upd_alias",
        watchId: BILLS_WATCH.id,
        action: "update",
        matchKey: "airtel::2026-11",
        values: {
          merchant: "Airtel Payments",
          billing_month: "2026-11",
          status: "Paid",
        },
        sourceComment: "payments@airtel.in",
        confidence: "high",
        emailMessageId: "msg_alias",
        createdAt: "2026-11-25T02:00:00.000Z",
      },
    ];

    const plan = planWorksheetSync(headers, rows, BILLS_WATCH, updates);
    expect(plan.rowsAdded).toBe(0);
    expect(plan.rowsUpdated).toBe(1);
    expect(plan.resultingRows).toHaveLength(1);
    expect(plan.resultingRows[0]![6]).toBe("Paid");
  });
});

describe("Excel.run sync integration & custom functions", () => {
  it("gracefully handles syncWorkbookWithExcel outside Excel host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workbookId: "wb-preview",
          watches: [BILLS_WATCH],
          pendingUpdates: [],
          agentLogs: [],
          gmailConnected: true,
          authStatus: "connected",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await syncWorkbookWithExcel("wb-preview");
    expect(res.inExcelHost).toBe(false);
    expect(res.syncPayload.gmailConnected).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes cells, fills, cell comments, _AgentLog rows, and acknowledges sync in Excel host", async () => {
    const writtenRanges: Array<{ row: number; col: number; values: unknown[][]; fillColor?: string }> = [];
    const addedComments: Array<{ address: string; content: string }> = [];
    const createdSheets: string[] = [];

    function createMockSheet(name: string, initialValues: CellMatrixValue[][]) {
      return {
        name,
        isNullObject: false,
        load: vi.fn(),
        activate: vi.fn(),
        getUsedRangeOrNullObject: () => ({
          isNullObject: initialValues.length === 0,
          rowCount: initialValues.length,
          columnCount: initialValues[0]?.length ?? 0,
          values: initialValues,
          load: vi.fn(),
        }),
        getRangeByIndexes: (row: number, col: number) => {
          const entry: { row: number; col: number; values: unknown[][]; fillColor?: string } = {
            row,
            col,
            values: [],
          };
          return {
            set values(val: unknown[][]) {
              entry.values = val;
              writtenRanges.push(entry);
            },
            set columnHidden(_hidden: boolean) {},
            format: {
              font: { bold: false },
              fill: {
                set color(c: string) {
                  entry.fillColor = c;
                },
              },
              borders: {
                getItem: () => ({ color: "" }),
              },
            },
          };
        },
        comments: {
          getItemByCell: () => {
            throw new Error("No existing comment");
          },
          add: (address: string, content: string) => {
            addedComments.push({ address, content });
          },
        },
      };
    }

    const billsSheet = createMockSheet("Bills", [
      [...BILLS_WATCH.columns, SHEETDOT_ID_COLUMN],
      ["Airtel", "2026-11", "Telecom", 1179, "INR", "2026-11-28", "Unpaid", "airtel::2026-11"],
    ]);
    const agentLogSheet = createMockSheet("_AgentLog", []);

    const mockContext = {
      workbook: {
        worksheets: {
          getItemOrNullObject: (name: string) => {
            if (name === "Bills") return billsSheet;
            return { isNullObject: true, load: vi.fn() };
          },
          add: (name: string) => {
            createdSheets.push(name);
            return agentLogSheet;
          },
        },
      },
      sync: vi.fn().mockResolvedValue(undefined),
    };

    vi.stubGlobal("Excel", {
      run: async (cb: (ctx: typeof mockContext) => Promise<void>) => cb(mockContext),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workbookId: "wb-excel",
            watches: [BILLS_WATCH],
            pendingUpdates: [
              {
                id: "upd_excel_1",
                watchId: BILLS_WATCH.id,
                action: "update",
                matchKey: "airtel::2026-11",
                values: {
                  merchant: "Airtel",
                  billing_month: "2026-11",
                  category: "Telecom",
                  amount: 1179,
                  currency: "INR",
                  due_date: "2026-11-28",
                  status: "Paid",
                },
                sourceComment: 'payments@airtel.in · "Paid"',
                confidence: "high",
                emailMessageId: "msg_1",
                createdAt: "2026-11-25T02:00:00.000Z",
              },
            ],
            agentLogs: [
              {
                id: "log_1",
                timestamp: "2026-11-25T02:30:00.000Z",
                watchName: "Monthly Bills",
                emailsScanned: 1,
                rowsAdded: 0,
                rowsUpdated: 1,
                status: "success",
                summary: "1 marked Paid",
              },
            ],
            gmailConnected: true,
            authStatus: "connected",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: 1 }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const res = await syncWorkbookWithExcel("wb-excel");
    expect(res.inExcelHost).toBe(true);
    expect(res.rowsUpdated).toBe(1);
    expect(res.acknowledgedCount).toBe(1);
    expect(createdSheets).toContain("_AgentLog");
    expect(addedComments).toEqual([
      { address: "D2", content: 'payments@airtel.in · "Paid"' },
    ]);
    expect(writtenRanges.some((w) => w.fillColor === CONFIDENCE_COLORS.high && w.values[0]?.[0] === "Paid")).toBe(true);
    expect(writtenRanges.some((w) => w.values[0]?.[0] === "log_1")).toBe(true);
  });

  it("calls Worker /api/ask and /api/watch-cell from =AI.ASK and =AI.WATCH", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ answer: "6,029", source: "mock", cached: false }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            watchId: "cell_1",
            answer: "6,029",
            source: "mock",
            cached: true,
            scheduleCron: "0 8 * * *",
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const askRes = await ask("Total?", [[1179], [4850]]);
    const watchRes = await watch("Total?", [[1179], [4850]], "daily");

    expect(askRes).toBe("6,029");
    expect(watchRes).toBe("6,029");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
