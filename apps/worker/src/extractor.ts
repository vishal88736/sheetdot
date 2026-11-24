import OpenAI from "openai";
import type { AskRequest, ConfidenceLevel, WatchConfig } from "@sheetdot/shared";
import type { GmailMessage } from "./composio.js";

export interface ExtractorEnv {
  MOCK_MODE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

export interface ExtractedEmailRecord {
  matched: boolean;
  confidence: ConfidenceLevel;
  confidenceReason: string;
  values: Record<string, string | number>;
}

const NUMERIC_COLUMN_HINTS = ["amount", "total", "price", "cost", "fee", "balance", "tax", "units"];

function isNumericColumn(columnName: string): boolean {
  const lower = columnName.toLowerCase();
  return NUMERIC_COLUMN_HINTS.some((hint) => lower.includes(hint));
}

function shouldUseMock(env: ExtractorEnv): boolean {
  return env.MOCK_MODE === "true" || (!env.OPENAI_API_KEY && env.MOCK_MODE !== "false");
}

function parseKeyValueLines(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const rawKey = line.slice(0, idx).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const rawVal = line.slice(idx + 1).trim();
    if (rawKey && rawVal) {
      map.set(rawKey, rawVal);
    }
  }
  return map;
}

function mockExtractFromEmail(
  email: GmailMessage,
  watch: WatchConfig
): ExtractedEmailRecord | null {
  const combined = `${email.bodyText}\n${email.attachmentText ?? ""}`;
  const kv = parseKeyValueLines(email.bodyText);

  const lookupMap: Record<string, string | undefined> = {
    merchant: kv.get("merchant"),
    billing_month: kv.get("billing_month"),
    category: kv.get("category"),
    amount: kv.get("amount"),
    currency: kv.get("currency") ?? "INR",
    due_date: kv.get("due_date"),
    status: kv.get("status"),
    service: kv.get("service"),
    plan: kv.get("plan"),
    billing_cycle: kv.get("billing_cycle"),
    renewal_date: kv.get("renewal_date"),
    pnr_or_booking_id: kv.get("pnr_booking_id") ?? kv.get("pnr_or_booking_id"),
    provider: kv.get("provider"),
    route_or_hotel: kv.get("route_hotel") ?? kv.get("route_or_hotel"),
    travel_date: kv.get("travel_date"),
    departure_time: kv.get("departure_time"),
  };

  const values: Record<string, string | number> = {};
  let matchedFields = 0;

  for (const col of watch.columns) {
    const normalizedCol = col.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const raw = kv.get(normalizedCol) ?? lookupMap[normalizedCol];

    if (raw !== undefined) {
      matchedFields += 1;
      if (isNumericColumn(col)) {
        const numeric = Number(raw.replace(/[^0-9.-]/g, ""));
        values[col] = Number.isFinite(numeric) ? numeric : 0;
      } else {
        values[col] = raw;
      }
    } else if (isNumericColumn(col)) {
      const amountMatch = combined.match(/(?:INR|Rs\.?|₹|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
      if (amountMatch?.[1]) {
        matchedFields += 1;
        values[col] = Number(amountMatch[1].replace(/,/g, ""));
      } else {
        values[col] = 0;
      }
    } else {
      values[col] = "";
    }
  }

  const primaryKeyCol = watch.matchKeyColumns[0];
  const primaryKeyVal = primaryKeyCol ? values[primaryKeyCol] : undefined;
  if (matchedFields < 2 || !primaryKeyVal || String(primaryKeyVal).trim() === "") {
    return null;
  }

  const missingKeyCol = watch.matchKeyColumns.some((col) => {
    const val = values[col];
    return val === undefined || String(val).trim() === "";
  });

  return {
    matched: true,
    confidence: missingKeyCol ? "needs_review" : "high",
    confidenceReason: missingKeyCol
      ? "Missing one or more match key fields"
      : "Extracted cleanly from email and statement text",
    values,
  };
}

function buildRowExtractionJsonSchema(columns: string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const col of columns) {
    properties[col] = isNumericColumn(col)
      ? { type: "number" }
      : { type: "string" };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["matched", "confidence", "confidenceReason", "values"],
    properties: {
      matched: { type: "boolean" },
      confidence: { type: "string", enum: ["high", "needs_review"] },
      confidenceReason: { type: "string" },
      values: {
        type: "object",
        additionalProperties: false,
        required: columns,
        properties,
      },
    },
  };
}

/**
 * Extracts structured table values from an email + optional PDF attachment text
 * using OpenAI Structured Outputs (or deterministic mock extraction).
 */
export async function extractRowFromEmail(
  email: GmailMessage,
  watch: WatchConfig,
  env: ExtractorEnv
): Promise<ExtractedEmailRecord | null> {
  if (shouldUseMock(env)) {
    return mockExtractFromEmail(email, watch);
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when MOCK_MODE is false.");
  }

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const schema = buildRowExtractionJsonSchema(watch.columns);

  const response = await openai.chat.completions.create({
    model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You are Sheetdot's structured email parser for an Excel watch table.",
          `Extract fields for watch "${watch.name}" (template: ${watch.templateId}).`,
          `Target columns: ${watch.columns.join(", ")}.`,
          `Deterministic match key columns: ${watch.matchKeyColumns.join(", ")}.`,
          "If the email is unrelated to this watch, return matched=false.",
          "Use YYYY-MM format for billing_month/billing_cycle and YYYY-MM-DD for dates when present.",
          "Set confidence='needs_review' if any amount, date, or key identifier is ambiguous.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Subject: ${email.subject}`,
          `From: ${email.from}`,
          `Received At: ${email.receivedAt}`,
          `Body:\n${email.bodyText}`,
          email.attachmentText ? `Extracted Attachment Text:\n${email.attachmentText}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sheetdot_email_extraction",
        strict: true,
        schema,
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return null;
  }

  const parsed = JSON.parse(content) as ExtractedEmailRecord;
  if (!parsed.matched) {
    return null;
  }
  return parsed;
}

function flattenRowValues(rowValues: AskRequest["rowValues"]): Array<string | number | boolean> {
  if (Array.isArray(rowValues)) {
    return rowValues
      .flat()
      .filter((v): v is string | number | boolean => v !== null && v !== undefined && v !== "");
  }
  return Object.values(rowValues).filter(
    (v): v is string | number | boolean => v !== null && v !== undefined && v !== ""
  );
}

function mockAnswerQuestion(
  question: string,
  rowValues: AskRequest["rowValues"]
): { answer: string; source: string } {
  const flat = flattenRowValues(rowValues);
  const numbers = flat
    .map((val) => (typeof val === "number" ? val : Number(String(val).replace(/[^0-9.-]/g, ""))))
    .filter((n) => Number.isFinite(n) && n !== 0);

  const lowerQ = question.toLowerCase();

  if (/\b(sum|total|add)\b/.test(lowerQ) && numbers.length > 0) {
    const sum = numbers.reduce((a, b) => a + b, 0);
    return {
      answer: `${sum.toLocaleString("en-IN")}`,
      source: "mock:cell-arithmetic",
    };
  }

  if (/\b(avg|average|mean)\b/.test(lowerQ) && numbers.length > 0) {
    const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    return {
      answer: `${avg.toFixed(2)}`,
      source: "mock:cell-arithmetic",
    };
  }

  if (/\b(max|highest|largest)\b/.test(lowerQ) && numbers.length > 0) {
    return {
      answer: `${Math.max(...numbers).toLocaleString("en-IN")}`,
      source: "mock:cell-arithmetic",
    };
  }

  if (/\b(status|paid|unpaid|due)\b/.test(lowerQ)) {
    const statusHit = flat.find((v) => /paid|unpaid|overdue|confirmed|active/i.test(String(v)));
    if (statusHit !== undefined) {
      return {
        answer: String(statusHit),
        source: "mock:context-lookup",
      };
    }
  }

  const preview = flat.slice(0, 5).map(String).join(" | ");
  return {
    answer: preview ? `${question.trim()} -> ${preview}` : "No context values provided.",
    source: "mock:openai-stub",
  };
}

/**
 * Answers an Excel `=AI.ASK` or `=AI.WATCH` formula prompt concisely for cell insertion.
 */
export async function answerSpreadsheetQuestion(
  question: string,
  rowValues: AskRequest["rowValues"],
  env: ExtractorEnv
): Promise<{ answer: string; source: string }> {
  if (shouldUseMock(env)) {
    return mockAnswerQuestion(question, rowValues);
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when MOCK_MODE is false.");
  }

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const model = env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 150,
    messages: [
      {
        role: "system",
        content:
          "You return concise, single-cell Excel formula results. Answer in plain text without markdown, keeping answers short enough for an Excel cell.",
      },
      {
        role: "user",
        content: `Question: ${question}\nContext Values: ${JSON.stringify(rowValues)}`,
      },
    ],
  });

  const answer = response.choices[0]?.message?.content?.trim() || "No answer";
  return {
    answer,
    source: `openai:${model}`,
  };
}
