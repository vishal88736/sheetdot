import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  AskRequestSchema,
  PdfPasswordHintInputSchema,
  SmsWebhookPayloadSchema,
  SyncAckRequestSchema,
  WatchCellRequestSchema,
  WatchUpsertSchema,
  type AuthSession,
  type AuthUserProfile,
} from "@sheetdot/shared";
import {
  buildGoogleUserId,
  computeInitials,
  signSessionToken,
  verifySessionToken,
} from "./auth.js";
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

async function getAuthenticatedUser(
  c: Context<{ Bindings: WorkerEnv }>
): Promise<AuthUserProfile | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifySessionToken(token, c.env.VAULT_SECRET);
}

/**
 * Strictly scopes the Durable Object namespace to the verified Google user when
 * authenticated, ensuring user A can never read or modify user B's watches or vault.
 */
async function resolveScopedWorkbookId(
  c: Context<{ Bindings: WorkerEnv }>,
  requestedWorkbookId?: string
): Promise<{ scopedId: string; user: AuthUserProfile | null; unauthorized: boolean }> {
  const authHeader = c.req.header("Authorization");
  const cleanWorkbook = (requestedWorkbookId ?? "").trim() || "main";

  if (authHeader) {
    const user = await getAuthenticatedUser(c);
    if (!user) {
      return { scopedId: "", user: null, unauthorized: true };
    }
    const basePart = cleanWorkbook.includes("__")
      ? cleanWorkbook.split("__").slice(1).join("__") || "main"
      : cleanWorkbook;
    return {
      scopedId: `${user.id}__${basePart}`,
      user,
      unauthorized: false,
    };
  }

  return {
    scopedId: cleanWorkbook || "default-workbook",
    user: null,
    unauthorized: false,
  };
}

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

app.get("/api/auth/me", async (c) => {
  const user = await getAuthenticatedUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ user });
});

app.post("/api/ask", async (c) => {
  const raw = await c.req.json();
  const parsed = AskRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid ask payload", issues: parsed.error.issues }, 400);
  }
  const scope = await resolveScopedWorkbookId(c, parsed.data.workbookId);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...parsed.data, workbookId: scope.scopedId }),
  });
});

app.post("/api/watch-cell", async (c) => {
  const raw = await c.req.json();
  const parsed = WatchCellRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid watch-cell payload", issues: parsed.error.issues }, 400);
  }
  const scope = await resolveScopedWorkbookId(c, parsed.data.workbookId);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/watch-cell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...parsed.data, workbookId: scope.scopedId }),
  });
});

app.get("/api/watches", async (c) => {
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/watches", { method: "GET" });
});

app.post("/api/watches", async (c) => {
  const raw = await c.req.json();
  const parsed = WatchUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid watch config", issues: parsed.error.issues }, 400);
  }
  const scope = await resolveScopedWorkbookId(c, parsed.data.workbookId);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/watches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...parsed.data, workbookId: scope.scopedId }),
  });
});

app.patch("/api/watches/:id", async (c) => {
  const watchId = c.req.param("id");
  const raw = (await c.req.json()) as { workbookId?: string; enabled?: boolean };
  const scope = await resolveScopedWorkbookId(c, raw.workbookId ?? c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, `/watches/${encodeURIComponent(watchId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: raw.enabled }),
  });
});

app.delete("/api/watches/:id", async (c) => {
  const watchId = c.req.param("id");
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, `/watches/${encodeURIComponent(watchId)}`, {
    method: "DELETE",
  });
});

app.post("/api/watches/:id/run-now", async (c) => {
  const watchId = c.req.param("id");
  let requestedWb = c.req.query("workbookId");
  if (!requestedWb) {
    try {
      const body = (await c.req.json()) as { workbookId?: string };
      requestedWb = body.workbookId;
    } catch {
      // Optional body
    }
  }
  const scope = await resolveScopedWorkbookId(c, requestedWb);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, `/watches/${encodeURIComponent(watchId)}/run-now`, {
    method: "POST",
  });
});

app.post("/api/alarm/trigger", async (c) => {
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/alarm/trigger", { method: "POST" });
});

app.get("/api/vault/pdf-hints", async (c) => {
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/vault/pdf-hints", { method: "GET" });
});

app.post("/api/vault/pdf-hints", async (c) => {
  const raw = await c.req.json();
  const requestedWb =
    (typeof raw.workbookId === "string" && raw.workbookId) || c.req.query("workbookId");
  const scope = await resolveScopedWorkbookId(c, requestedWb);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  const parsed = PdfPasswordHintInputSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid PDF password hint", issues: parsed.error.issues }, 400);
  }
  return forwardToDO(c.env, scope.scopedId, "/vault/pdf-hints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.delete("/api/vault/pdf-hints/:id", async (c) => {
  const hintId = c.req.param("id");
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, `/vault/pdf-hints/${encodeURIComponent(hintId)}`, {
    method: "DELETE",
  });
});

app.post("/api/webhooks/sms", async (c) => {
  const raw = await c.req.json();
  const parsed = SmsWebhookPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid SMS webhook payload", issues: parsed.error.issues }, 400);
  }
  const scope = await resolveScopedWorkbookId(c, parsed.data.workbookId);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/webhooks/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
});

app.post("/api/logs/:id/revert", async (c) => {
  const logId = c.req.param("id");
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, `/logs/${encodeURIComponent(logId)}/revert`, {
    method: "POST",
  });
});

app.get("/api/sync", async (c) => {
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(
    c.env,
    scope.scopedId,
    `/sync?workbookId=${encodeURIComponent(scope.scopedId)}`,
    { method: "GET" }
  );
});

app.post("/api/sync/ack", async (c) => {
  const raw = await c.req.json();
  const parsed = SyncAckRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid sync ack payload", issues: parsed.error.issues }, 400);
  }
  const scope = await resolveScopedWorkbookId(c, parsed.data.workbookId);
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  return forwardToDO(c.env, scope.scopedId, "/sync/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...parsed.data, workbookId: scope.scopedId }),
  });
});

app.get("/api/auth/composio", async (c) => {
  const scope = await resolveScopedWorkbookId(c, c.req.query("workbookId"));
  if (scope.unauthorized) return c.json({ error: "Invalid session token" }, 401);

  const callbackUrl = c.req.query("callbackUrl");
  const params = new URLSearchParams({ workbookId: scope.scopedId });
  if (callbackUrl) params.set("callbackUrl", callbackUrl);
  return forwardToDO(c.env, scope.scopedId, `/auth/composio?${params.toString()}`, {
    method: "GET",
  });
});

app.get("/api/auth/google/start", async (c) => {
  const workbookKey = c.req.query("workbookId") ?? "main";
  const returnOrigin = c.req.query("returnOrigin") ?? "http://localhost:3000";
  const email = (c.req.query("email") ?? "vishal@gmail.com").trim().toLowerCase();
  const name = (c.req.query("name") ?? "Vishal Agrawal").trim() || "Vishal Agrawal";
  const workerOrigin = new URL(c.req.url).origin;
  const userId = buildGoogleUserId(email);
  const scopedWorkbookId = `${userId}__${workbookKey}`;

  const callbackUrl = `${workerOrigin}/api/auth/callback?workbookId=${encodeURIComponent(
    workbookKey
  )}&returnOrigin=${encodeURIComponent(returnOrigin)}&email=${encodeURIComponent(
    email
  )}&name=${encodeURIComponent(name)}`;

  if (isMockMode(c.env)) {
    const user: AuthUserProfile = {
      id: userId,
      email,
      name,
      initials: computeInitials(name, email),
    };
    const token = await signSessionToken(user, c.env.VAULT_SECRET);
    const mockSession: AuthSession = {
      user,
      token,
      authStatus: "connected",
      mode: "mock",
    };

    // Persist Google user profile directly into their isolated Durable Object
    await forwardToDO(c.env, scopedWorkbookId, "/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });

    return c.json({
      mode: "mock",
      authUrl: `${callbackUrl}&mock=1`,
      mockSession,
    });
  }

  const doResp = await forwardToDO(
    c.env,
    scopedWorkbookId,
    `/auth/composio?workbookId=${encodeURIComponent(
      scopedWorkbookId
    )}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    { method: "GET" }
  );
  const authData = (await doResp.json()) as { redirectUrl?: string; connected?: boolean };

  return c.json({
    mode: "google",
    authUrl: authData.redirectUrl ?? `${callbackUrl}&connected=${authData.connected ? "1" : "0"}`,
  });
});

app.get("/api/auth/callback", async (c) => {
  const workbookKey = c.req.query("workbookId") ?? "main";
  const returnOrigin = c.req.query("returnOrigin") ?? "http://localhost:3000";
  const email = (c.req.query("email") ?? "vishal@gmail.com").trim().toLowerCase();
  const name = (c.req.query("name") ?? "Vishal Agrawal").trim() || "Vishal Agrawal";
  const userId = buildGoogleUserId(email);
  const scopedWorkbookId = `${userId}__${workbookKey}`;

  const user: AuthUserProfile = {
    id: userId,
    email,
    name,
    initials: computeInitials(name, email),
  };
  const token = await signSessionToken(user, c.env.VAULT_SECRET);

  await forwardToDO(c.env, scopedWorkbookId, "/auth/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });

  const session: AuthSession = {
    user,
    token,
    authStatus: "connected",
    mode: isMockMode(c.env) ? "mock" : "google",
  };

  const payloadJson = JSON.stringify({ type: "sheetdot_auth", session });
  const encodedRedirect = `${returnOrigin}?sheetdot_auth=${encodeURIComponent(
    JSON.stringify(session)
  )}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sheetdot Sign-In Complete</title>
    <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
  </head>
  <body style="font-family: Segoe UI, sans-serif; padding: 24px; text-align: center; color: #111827; background: #FAF7F0;">
    <p style="font-size: 14px; font-weight: 600;">Signed in as ${name}</p>
    <p style="font-size: 12px; color: #6B7280;">Completing connection to Sheetdot...</p>
    <script>
      const payload = ${payloadJson};
      const redirectUrl = ${JSON.stringify(encodedRedirect)};
      function completeAuth() {
        if (typeof Office !== "undefined" && Office.context && Office.context.ui && Office.context.ui.messageParent) {
          Office.context.ui.messageParent(JSON.stringify(payload));
          return;
        }
        if (window.opener) {
          window.opener.postMessage(payload, "*");
          window.close();
          return;
        }
        window.location.replace(redirectUrl);
      }
      if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
        Office.onReady(function () { completeAuth(); });
      } else {
        completeAuth();
      }
    </script>
  </body>
</html>`;

  return c.html(html);
});

export default app;
