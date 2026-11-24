# Sheetdot

**Sheetdot** is an Excel-native control plane for 24/7 personal agents. Users interact directly through Excel custom functions (`=AI.ASK`, `=AI.WATCH`) and a minimal 320px Task Pane—never a chatbot sidebar.

## Architecture

```text
sheetdot/
├── packages/shared/       # Zod schemas, TypeScript contracts, built-in templates
├── apps/worker/           # Cloudflare Worker (Hono) + SQLite Durable Objects + Alarms
└── apps/addin/            # Excel Add-in (Office.js Shared Runtime + React + Tailwind)
```

### Key Features

- **Always-On Durable Object Alarms (`apps/worker/src/workbook-do.ts`)**: Runs scheduled scans (e.g. `0 8 * * *` daily at 8:00 AM) even while Excel is closed, reading Gmail via `@composio/core` (read-only), extracting structured records via OpenAI Structured Outputs (`response_format: { type: "json_schema" }`), scoring anomalies (`needs_review`), and queuing `PendingRowUpdate` rows in SQLite.
- **Zero-Recalc Waste (`answer_cache`)**: `=AI.ASK` and `=AI.WATCH` hash `(question + rowValues)` with SHA-256 in the Durable Object so Excel recalculations reuse cached answers.
- **Row-Safe Sync (`apps/addin/src/sync/excelSync.ts`)**: Matches existing rows by deterministic `matchKey` (and hidden `_sheetdot_id` column) rather than raw row numbers—preserving manual edits and surviving sorts or row shifts.
- **Visual Provenance**: High-confidence cells highlight yellow (`#FEF08A`), flagged anomalies highlight orange (`#FED7AA`), source email provenance is attached as native Excel cell comments, and every run appends to `_AgentLog`.

---

## Prerequisites

- Node.js 22+ and npm
- Microsoft Excel (Desktop or Web) for sideloading the add-in

---

## 1. Install Dependencies & Run Checks

```bash
npm install
npm run typecheck
npm test
npm run build
```

---

## 2. Run the Cloudflare Worker Locally (`MOCK_MODE=true`)

`apps/worker/wrangler.toml` enables `MOCK_MODE = "true"` by default so the entire end-to-end flow runs locally with realistic Indian utility, telecom, credit-card, subscription, and travel emails—no API keys required.

```bash
npm run dev:worker
```

This starts the Worker + local Durable Objects at `http://localhost:8787`.

### Optional: Live Gmail (Composio) & OpenAI Secrets

For live Gmail & OpenAI extraction, set `MOCK_MODE = "false"` in `apps/worker/wrangler.toml` (or `.dev.vars`) and add secrets:

```bash
cd apps/worker
npx wrangler secret put COMPOSIO_API_KEY
npx wrangler secret put COMPOSIO_GMAIL_AUTH_CONFIG_ID
npx wrangler secret put OPENAI_API_KEY
# Optional morning WhatsApp/email digest webhook:
npx wrangler secret put DIGEST_WEBHOOK_URL
```

---

## 3. Run & Sideload the Excel Add-in

Start the Task Pane and Custom Functions dev server on port `3000`:

```bash
npm run dev:addin
```

> **Note on HTTPS for Excel Desktop / Web:** Office Add-in manifests (`apps/addin/manifest.xml`) expect `https://localhost:3000`. If sideloading into Excel Desktop or Excel on the Web, ensure local trusted HTTPS dev certs are configured (for example via `npx office-addin-dev-certs install` or a local HTTPS proxy to `http://localhost:3000`).

### Sideload `apps/addin/manifest.xml`

- **Excel on the Web**: Open a workbook -> **Home** -> **Add-ins** -> **More Add-ins** -> **Upload My Add-in** -> select `apps/addin/manifest.xml`.
- **Excel Desktop (macOS / Windows)**: Sideload `apps/addin/manifest.xml` via `npx office-addin-debugging start apps/addin/manifest.xml` or copy the manifest to your Office sideload folder (`~/Library/Containers/com.microsoft.Excel/Data/Documents/wef` on macOS).

---

## 4. Test the Full Overnight Loop with `Run Now`

You can test the complete pipeline either from the **Sheetdot** Task Pane or directly via `curl` while `wrangler dev` is running:

### Via the Task Pane UI
1. Open the **Sheetdot** pane from the **Home** ribbon tab.
2. Go to the **Templates** tab and click **Enable** on **Bill Tracker** (creates the `Bills` tab headers + hidden `_sheetdot_id` column and schedules the `0 8 * * *` watch).
3. Switch to the **Watches** tab and click **Run Now**.
4. Sheetdot scans mock Gmail messages, flags BESCOM's +131% bill jump as `needs_review` (`#FED7AA` orange), marks Airtel's bill as `Paid` via `matchKey` update (`#FEF08A` yellow), adds email provenance comments, and logs the run to **Activity** and `_AgentLog`.
5. Click **Run Now** a second time to verify `processed_emails` deduplication (`0` new rows added).

### Via `curl` (Smoke Test)
```bash
# 1. Create a Monthly Bills watch
curl -s -X POST http://localhost:8787/api/watches \
  -H "Content-Type: application/json" \
  -d '{
    "workbookId": "demo-wb",
    "name": "Monthly Bills",
    "templateId": "bills",
    "sheetName": "Bills",
    "scheduleCron": "0 8 * * *",
    "composioQuery": "bill OR invoice OR receipt OR statement OR payment",
    "matchKeyColumns": ["merchant", "billing_month"],
    "columns": ["merchant", "billing_month", "category", "amount", "currency", "due_date", "status"],
    "anomalyThresholdPct": 20,
    "enabled": true
  }'

# 2. Trigger the watch immediately (replace <WATCH_ID> from response above)
curl -s -X POST "http://localhost:8787/api/watches/<WATCH_ID>/run-now?workbookId=demo-wb"

# 3. Inspect pending updates and _AgentLog entries
curl -s "http://localhost:8787/api/sync?workbookId=demo-wb"

# 4. Test =AI.ASK caching (1st call cached: false, 2nd call cached: true)
curl -s -X POST http://localhost:8787/api/ask \
  -H "Content-Type: application/json" \
  -d '{"workbookId":"demo-wb","question":"Total amount?","rowValues":[["Airtel",1179],["BESCOM",4850]]}'
```
