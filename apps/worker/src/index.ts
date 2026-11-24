import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  AskRequestSchema,
  PdfPasswordHintInputSchema,
  SmsWebhookPayloadSchema,
  SyncAckRequestSchema,
  WatchCellRequestSchema,
  WatchUpsertSchema,
} from "@sheetdot/shared";
import { isMockMode } from "./composio.js";
import { WorkbookDurableObject, type WorkerEnv } from "./workbook-do.js";

export { WorkbookDurableObject };

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

function getWorkbookStub(env: WorkerEnv, workbookId: string): DurableObjectStub {
  const normalized = workbookId.trim() || "default-workbook";
  const id = env.WORKBOOK_DO.idFromName(normalized);
  return env.WORKBOOK_DO.get(id);
}

async function forwardToDO(
  env: WorkerEnv,
  workbookId: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const stub = getWorkbookStub(env, workbookId);
  const targetUrl = `https://workbook-do.internal${path}`;
  return stub.fetch(targetUrl, init);
}

app.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "sheetdot-worker",
    mockMode: isMockMode(c.env),
  });
});

app.post("/api/ask", async (c) => {
  const raw = await c.req.json();
  const parsed = AskRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid ask payload", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, parsed.data.workbookId, "/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.post("/api/watch-cell", async (c) => {
  const raw = await c.req.json();
  const parsed = WatchCellRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid watch-cell payload", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, parsed.data.workbookId, "/watch-cell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.get("/api/watches", async (c) => {
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, "/watches", { method: "GET" });
});

app.post("/api/watches", async (c) => {
  const raw = await c.req.json();
  const parsed = WatchUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid watch config", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, parsed.data.workbookId, "/watches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.patch("/api/watches/:id", async (c) => {
  const watchId = c.req.param("id");
  const raw = (await c.req.json()) as { workbookId?: string; enabled?: boolean };
  const workbookId = raw.workbookId ?? c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, `/watches/${encodeURIComponent(watchId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: raw.enabled }),
  });
});

app.delete("/api/watches/:id", async (c) => {
  const watchId = c.req.param("id");
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, `/watches/${encodeURIComponent(watchId)}`, {
    method: "DELETE",
  });
});

app.post("/api/watches/:id/run-now", async (c) => {
  const watchId = c.req.param("id");
  let workbookId = c.req.query("workbookId");
  if (!workbookId) {
    try {
      const body = (await c.req.json()) as { workbookId?: string };
      workbookId = body.workbookId;
    } catch {
      // Optional body
    }
  }
  return forwardToDO(
    c.env,
    workbookId ?? "default-workbook",
    `/watches/${encodeURIComponent(watchId)}/run-now`,
    { method: "POST" }
  );
});

app.post("/api/alarm/trigger", async (c) => {
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, "/alarm/trigger", { method: "POST" });
});

app.get("/api/vault/pdf-hints", async (c) => {
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, "/vault/pdf-hints", { method: "GET" });
});

app.post("/api/vault/pdf-hints", async (c) => {
  const raw = await c.req.json();
  const workbookId =
    (typeof raw.workbookId === "string" && raw.workbookId) ||
    c.req.query("workbookId") ||
    "default-workbook";
  const parsed = PdfPasswordHintInputSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid PDF password hint", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, workbookId, "/vault/pdf-hints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.delete("/api/vault/pdf-hints/:id", async (c) => {
  const hintId = c.req.param("id");
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, `/vault/pdf-hints/${encodeURIComponent(hintId)}`, {
    method: "DELETE",
  });
});

app.post("/api/webhooks/sms", async (c) => {
  const raw = await c.req.json();
  const parsed = SmsWebhookPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid SMS webhook payload", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, parsed.data.workbookId, "/webhooks/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.post("/api/logs/:id/revert", async (c) => {
  const logId = c.req.param("id");
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(c.env, workbookId, `/logs/${encodeURIComponent(logId)}/revert`, {
    method: "POST",
  });
});

app.get("/api/sync", async (c) => {
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  return forwardToDO(
    c.env,
    workbookId,
    `/sync?workbookId=${encodeURIComponent(workbookId)}`,
    { method: "GET" }
  );
});

app.post("/api/sync/ack", async (c) => {
  const raw = await c.req.json();
  const parsed = SyncAckRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid sync ack payload", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, parsed.data.workbookId, "/sync/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.get("/api/auth/composio", async (c) => {
  const workbookId = c.req.query("workbookId") ?? "default-workbook";
  const callbackUrl = c.req.query("callbackUrl");
  const params = new URLSearchParams({ workbookId });
  if (callbackUrl) params.set("callbackUrl", callbackUrl);
  return forwardToDO(c.env, workbookId, `/auth/composio?${params.toString()}`, {
    method: "GET",
  });
});

export default app;
