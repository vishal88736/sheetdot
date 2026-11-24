import { Composio } from "@composio/core";
import type { ComposioAuthResponse } from "@sheetdot/shared";

export interface GmailMessage {
  messageId: string;
  threadId?: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  bodyText: string;
  attachmentText?: string;
}

export interface FetchMessagesResult {
  messages: GmailMessage[];
  authExpired: boolean;
  errorMessage?: string;
}

export interface ComposioEnv {
  MOCK_MODE?: string;
  COMPOSIO_API_KEY?: string;
  COMPOSIO_GMAIL_AUTH_CONFIG_ID?: string;
}

export function isMockMode(env: ComposioEnv): boolean {
  return env.MOCK_MODE === "true" || (!env.COMPOSIO_API_KEY && env.MOCK_MODE !== "false");
}

const MOCK_GMAIL_MESSAGES: Array<GmailMessage & { tags: string[] }> = [
  {
    messageId: "msg_bill_bescom_2026_10",
    threadId: "thr_bescom_10",
    subject: "BESCOM Electricity Bill - Oct 2026 (Account 4829103)",
    from: "ebill@bescom.co.in",
    receivedAt: "2026-10-05T03:30:00.000Z",
    snippet: "Your BESCOM electricity bill for October 2026 is INR 2,100.00. Status: Paid.",
    bodyText:
      "Merchant: BESCOM\nBilling Month: 2026-10\nCategory: Electricity\nAmount: 2100\nCurrency: INR\nDue Date: 2026-10-20\nStatus: Paid\nReference: BES-2026-10-4829103",
    attachmentText:
      "BESCOM Tax Invoice | Consumer: 4829103 | Cycle: 2026-10 | Total Payable: INR 2100.00 | Payment Status: Paid via UPI",
    tags: ["bill", "invoice", "receipt", "statement", "payment", "electricity", "bescom"],
  },
  {
    messageId: "msg_bill_bescom_2026_11",
    threadId: "thr_bescom_11",
    subject: "BESCOM Electricity Bill - Nov 2026 (Account 4829103)",
    from: "ebill@bescom.co.in",
    receivedAt: "2026-11-24T18:10:00.000Z",
    snippet: "Your BESCOM electricity bill for November 2026 is INR 4,850.00. Due 2026-12-05.",
    bodyText:
      "Merchant: BESCOM\nBilling Month: 2026-11\nCategory: Electricity\nAmount: 4850\nCurrency: INR\nDue Date: 2026-12-05\nStatus: Unpaid\nNote: Higher AC/heater usage recorded this cycle.",
    attachmentText:
      "PDF Attachment (BESCOM_Nov2026.pdf): Consumer 4829103 | Billing Period: 2026-11 | Units: 540 kWh | Total Due: INR 4850.00 | Due Date: 2026-12-05 | Status: Unpaid",
    tags: ["bill", "invoice", "receipt", "statement", "payment", "electricity", "bescom"],
  },
  {
    messageId: "msg_bill_airtel_2026_11",
    threadId: "thr_airtel_11",
    subject: "Airtel Black Fiber & Postpaid e-Bill for Nov 2026",
    from: "ebill@airtel.in",
    receivedAt: "2026-11-20T09:15:00.000Z",
    snippet: "Your Airtel Black bill of INR 1,179.00 for 2026-11 is ready. Due date 2026-11-28.",
    bodyText:
      "Merchant: Airtel\nBilling Month: 2026-11\nCategory: Telecom & Fiber\nAmount: 1179\nCurrency: INR\nDue Date: 2026-11-28\nStatus: Unpaid\nPlan: Airtel Black 999 + GST",
    attachmentText:
      "PDF Attachment (Airtel_Nov2026.pdf): Account 70291822 | Month: 2026-11 | Amount: INR 1179.00 | Due: 2026-11-28",
    tags: ["bill", "invoice", "receipt", "statement", "payment", "airtel", "telecom"],
  },
  {
    messageId: "msg_bill_airtel_2026_11_paid",
    threadId: "thr_airtel_11",
    subject: "Payment Received: Airtel Black Bill Nov 2026 (INR 1,179)",
    from: "payments@airtel.in",
    receivedAt: "2026-11-24T20:05:00.000Z",
    snippet: "Thank you! We received your UPI payment of INR 1,179.00 for Airtel Nov 2026.",
    bodyText:
      "Merchant: Airtel\nBilling Month: 2026-11\nCategory: Telecom & Fiber\nAmount: 1179\nCurrency: INR\nDue Date: 2026-11-28\nStatus: Paid\nUPI Ref: 632910448912",
    tags: ["bill", "invoice", "receipt", "statement", "payment", "airtel", "paid"],
  },
  {
    messageId: "msg_bill_hdfc_2026_11",
    threadId: "thr_hdfc_11",
    subject: "HDFC Bank Regalia Credit Card Statement - Nov 2026",
    from: "estatements@hdfcbank.net",
    receivedAt: "2026-11-24T22:15:00.000Z",
    snippet: "Your HDFC Credit Card statement for Nov 2026 is attached. Total due: INR 18,420.",
    bodyText:
      "Merchant: HDFC Credit Card\nBilling Month: 2026-11\nCategory: Credit Card\nAmount: 18420\nCurrency: INR\nDue Date: 2026-12-08\nStatus: Unpaid",
    attachmentText:
      "PDF Attachment (HDFC_Regalia_2026_11.pdf): Statement Month 2026-11 | Total Amount Due: INR 18420.00 | Minimum Due: INR 921.00 | Payment Due Date: 2026-12-08",
    tags: ["bill", "invoice", "receipt", "statement", "payment", "hdfc", "credit card"],
  },
  {
    messageId: "msg_sub_notion_2026_11",
    threadId: "thr_notion_11",
    subject: "Your Notion Plus subscription renewal receipt (Nov 2026)",
    from: "billing@makenotion.com",
    receivedAt: "2026-11-23T06:00:00.000Z",
    snippet: "Invoice for Notion Plus monthly renewal: INR 840 billed for 2026-11.",
    bodyText:
      "Service: Notion\nPlan: Plus Monthly\nBilling Cycle: 2026-11\nAmount: 840\nCurrency: INR\nRenewal Date: 2026-12-23\nStatus: Active",
    tags: ["subscription", "renewal", "recurring", "auto-pay", "membership", "notion"],
  },
  {
    messageId: "msg_sub_youtube_2026_11",
    threadId: "thr_yt_11",
    subject: "YouTube Premium Family auto-pay receipt - Nov 2026",
    from: "googleplay-noreply@google.com",
    receivedAt: "2026-11-24T04:15:00.000Z",
    snippet: "Your recurring YouTube Premium Family membership renewed for INR 299.",
    bodyText:
      "Service: YouTube Premium\nPlan: Family Monthly\nBilling Cycle: 2026-11\nAmount: 299\nCurrency: INR\nRenewal Date: 2026-12-24\nStatus: Active",
    tags: ["subscription", "renewal", "recurring", "auto-pay", "membership", "youtube"],
  },
  {
    messageId: "msg_travel_indigo_6e214",
    threadId: "thr_indigo_12",
    subject: "IndiGo Flight Itinerary & e-Ticket | PNR XY7K9P (BLR -> BOM)",
    from: "reservations@goindigo.in",
    receivedAt: "2026-11-24T11:30:00.000Z",
    snippet: "Booking confirmed for 6E-214 BLR to BOM on 2026-12-10. PNR: XY7K9P.",
    bodyText:
      "PNR / Booking ID: XY7K9P\nProvider: IndiGo\nRoute / Hotel: BLR -> BOM (6E-214)\nTravel Date: 2026-12-10\nDeparture Time: 07:15\nAmount: 6450\nStatus: Confirmed",
    tags: ["pnr", "itinerary", "booking", "flight", "irctc", "hotel", "indigo"],
  },
  {
    messageId: "msg_travel_irctc_82419",
    threadId: "thr_irctc_12",
    subject: "IRCTC e-Ticket Confirmation | PNR 4518293012 (SBC -> MAS)",
    from: "ticketadmin@irctc.co.in",
    receivedAt: "2026-11-24T14:40:00.000Z",
    snippet: "Shatabdi Express ticket confirmed for 2026-12-14. PNR 4518293012.",
    bodyText:
      "PNR / Booking ID: 4518293012\nProvider: IRCTC\nRoute / Hotel: SBC -> MAS (12028 Shatabdi)\nTravel Date: 2026-12-14\nDeparture Time: 06:00\nAmount: 1425\nStatus: Confirmed",
    tags: ["pnr", "itinerary", "booking", "flight", "irctc", "hotel", "train"],
  },
];

function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+(?:or|and)\s+|[\s,;|]+/i)
    .map((term) => term.replace(/^["']|["']$/g, "").trim())
    .filter((term) => term.length >= 2);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeComposioEmails(rawData: unknown): GmailMessage[] {
  const data = toRecord(rawData);
  const candidates = Array.isArray(rawData)
    ? rawData
    : Array.isArray(data.messages)
      ? data.messages
      : Array.isArray(data.emails)
        ? data.emails
        : Array.isArray(data.items)
          ? data.items
          : [];

  return candidates
    .map((item, idx): GmailMessage | null => {
      const rec = toRecord(item);
      const messageId = String(rec.messageId ?? rec.id ?? rec.message_id ?? "").trim();
      if (!messageId) {
        return null;
      }
      const subject = String(rec.subject ?? rec.Subject ?? "(No Subject)");
      const from = String(rec.sender ?? rec.from ?? rec.From ?? "unknown@gmail.com");
      const receivedAt = String(rec.messageTimestamp ?? rec.receivedAt ?? rec.date ?? new Date().toISOString());
      const snippet = String(rec.snippet ?? rec.preview ?? "");
      const bodyText = String(rec.messageText ?? rec.body ?? rec.text ?? snippet);
      const attachmentText = typeof rec.attachmentText === "string" ? rec.attachmentText : undefined;

      return {
        messageId,
        threadId: typeof rec.threadId === "string" ? rec.threadId : `thr_${idx}`,
        subject,
        from,
        receivedAt,
        snippet,
        bodyText,
        attachmentText,
      };
    })
    .filter((m): m is GmailMessage => m !== null);
}

/**
 * Generates or checks a read-only Gmail connection using @composio/core (or mock mode).
 */
export async function getComposioAuthStatus(
  workbookId: string,
  env: ComposioEnv,
  callbackUrl?: string
): Promise<ComposioAuthResponse> {
  if (isMockMode(env)) {
    return {
      connected: true,
      authStatus: "connected",
      mode: "mock",
      message: "Mock Gmail (Read-Only) active with sample Indian bills, subscriptions, and travel emails.",
    };
  }

  if (!env.COMPOSIO_API_KEY) {
    return {
      connected: false,
      authStatus: "disconnected",
      mode: "composio",
      message: "Missing COMPOSIO_API_KEY secret in Cloudflare Worker environment.",
    };
  }

  const composio = new Composio({ apiKey: env.COMPOSIO_API_KEY });
  const userId = `workbook_${workbookId}`;

  const existing = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: ["gmail"],
  });

  const activeAccount = existing.items.find((acct) => acct.status === "ACTIVE");
  if (activeAccount) {
    return {
      connected: true,
      authStatus: "connected",
      mode: "composio",
      message: "Gmail connected (Read-Only).",
    };
  }

  if (env.COMPOSIO_GMAIL_AUTH_CONFIG_ID) {
    const req = await composio.connectedAccounts.link(userId, env.COMPOSIO_GMAIL_AUTH_CONFIG_ID, {
      callbackUrl,
    });
    return {
      connected: false,
      authStatus: "disconnected",
      redirectUrl: req.redirectUrl ?? undefined,
      mode: "composio",
      message: "Authorize read-only Gmail access via Composio.",
    };
  }

  const session = await composio.sessions.create(userId, { toolkits: ["gmail"] });
  const req = await session.authorize("gmail", callbackUrl ? { callbackUrl } : undefined);
  return {
    connected: false,
    authStatus: "disconnected",
    redirectUrl: req.redirectUrl ?? undefined,
    mode: "composio",
    message: "Authorize read-only Gmail access via Composio session.",
  };
}

/**
 * Fetches recent/unread Gmail messages matching `query` in read-only mode.
 */
export async function fetchGmailMessages(
  workbookId: string,
  query: string,
  env: ComposioEnv
): Promise<FetchMessagesResult> {
  if (isMockMode(env)) {
    const terms = extractQueryTerms(query);
    if (terms.length === 0) {
      return {
        messages: MOCK_GMAIL_MESSAGES.map(({ tags: _tags, ...msg }) => msg),
        authExpired: false,
      };
    }

    const matched = MOCK_GMAIL_MESSAGES.filter((msg) => {
      const haystack = `${msg.subject} ${msg.bodyText} ${msg.tags.join(" ")}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    }).map(({ tags: _tags, ...msg }) => msg);

    return {
      messages: matched,
      authExpired: false,
    };
  }

  if (!env.COMPOSIO_API_KEY) {
    return {
      messages: [],
      authExpired: true,
      errorMessage: "COMPOSIO_API_KEY is not configured.",
    };
  }

  try {
    const composio = new Composio({ apiKey: env.COMPOSIO_API_KEY });
    const userId = `workbook_${workbookId}`;
    const accounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ["gmail"],
    });
    const active = accounts.items.find((acct) => acct.status === "ACTIVE");
    if (!active) {
      return {
        messages: [],
        authExpired: true,
        errorMessage: "Gmail OAuth connection is missing or expired. Please reconnect.",
      };
    }

    const result = await composio.tools.execute("GMAIL_FETCH_EMAILS", {
      userId,
      connectedAccountId: active.id,
      dangerouslySkipVersionCheck: true,
      arguments: {
        query,
        max_results: 15,
      },
    });

    if (!result.successful) {
      const errText = result.error ?? "Failed to execute GMAIL_FETCH_EMAILS";
      const isAuthIssue = /auth|token|expired|unauthorized|401/i.test(errText);
      return {
        messages: [],
        authExpired: isAuthIssue,
        errorMessage: errText,
      };
    }

    return {
      messages: normalizeComposioEmails(result.data),
      authExpired: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAuthIssue = /auth|token|expired|unauthorized|401|connected account/i.test(message);
    return {
      messages: [],
      authExpired: isAuthIssue,
      errorMessage: message,
    };
  }
}
