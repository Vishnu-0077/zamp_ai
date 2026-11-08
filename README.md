# Invoice processing

The repository has three application directories:

```text
backend/                 All backend code, configuration, dependencies and API docs
  main.py                FastAPI application entry point
  processing_api.py      Ingestion, case management and review endpoints
  inbox_api.py           Existing inbox demo endpoints
  invoice_service.py     Persistent processing and review workflow
  invoice_extractor.py   PDF/OCR routing and LangChain extraction
  invoice_rules.py       Matching, confidence and decision rules
  invoice_checks.py      Deterministic financial and vendor checks
  approved_export.py     Excel register of approved invoices
  audit_inbox.py         Live end-to-end audit of the 50-email inbox against the labels
  schemas.py             Extraction and API schemas
  database.py            SQLite persistence and audit storage
  settings.py            Environment configuration and repository paths
  procurement.json       Trusted procurement master and policy
  requirements.txt       Python dependencies
  start.sh               Local provider startup helper
  Dockerfile             Container build with Tesseract OCR
  .env.example           Environment configuration example
  README.md              Setup, API integration and operational guide
  openapi.json           Exported frontend API contract
  export_openapi.py      API contract export utility
  test_reset.py          Reset regression tests
  test_audit_fixes.py    Regression tests for fixes found by the live audit
  runtime/               Local processing data and the Excel export (ignored by Git)
frontend/                React + TypeScript review app (see frontend/README.md)
  src/                   API client, feature modules (case summary, compare & resolve), shared components
  inbox.html             Legacy inbox page, still served by the backend at /
test_cases/              All tests, test-data tools and sample documents
  test_backend.py        Processing and API regression tests
  test_invoice_checks.py Financial rule boundary tests
  generate_inbox.py      Synthetic inbox generator
  validate_inbox.py      Fixture integrity checks
  invoice_layouts.py     Supplier PDF layouts and scan rendering
  invoice_scenarios.py   Synthetic invoice scenarios
  expand_inbox.py        Compatibility entry point for inbox generation
  EDGE_CASES.md          Exception scenario descriptions
  test_inputs/           Sample emails, PDFs, inbox database and ground truth
```

The local `zamp_venv/` is the Python environment, not application source.
All commands below run from the repository root.

## How it works

1. An invoice PDF arrives from the vendor inbox, a PDF upload or an `.eml` upload.
2. The backend reads every page, using digital text or Tesseract OCR for scans.
   OCR output is rebuilt into visual rows, so a label and its value
   ("Issued 2026-10-18") stay on one line.
3. LangChain and an OpenAI-compatible model extract structured facts. The
   model only extracts; it never decides.
4. Deterministic Python validates the facts, checks the vendor and bank
   details, detects duplicates, matches the PO, checks the math, dates, FX and
   GST, then decides.
5. The case ends as **approved** (PO value reserved locally), **duplicate**,
   or **review**, held for a human.
6. A reviewer compares the invoice with its PO in the dashboard and either
   corrects the data (every rule reruns) or, after checking it by eye,
   approves it manually. A manual approval must acknowledge every open issue
   and is recorded in the audit trail.
7. Every approved invoice lands in an Excel register that the dashboard can
   download and the backend keeps up to date on disk.

No payments are executed and no emails are sent.

## Running the dashboard

You run two processes: the **backend** (FastAPI, port 8000) and the
**dashboard** (React, port 5173). The dashboard talks to the backend through
a local proxy.

### 1. Prerequisites

| Tool | Needed for | Check |
| --- | --- | --- |
| Python 3.11+ | Backend | `python3 --version` |
| Node.js 20+ and npm | Dashboard | `node -v && npm -v` |
| Tesseract OCR (optional) | Scanned or image-only PDFs | `tesseract --version` |
| Model API key (optional) | Automatic extraction | An OpenAI or compatible provider key |

Without Tesseract, scanned invoices stop in review with `OCR_UNAVAILABLE`.
Without a model, every invoice stops in review with
`EXTRACTION_NOT_CONFIGURED`. The dashboard still works in both cases, and
those cases can be retried once the dependency is installed.

### 2. One-time setup

From the repository root:

```bash
# Python environment and backend dependencies
python3 -m venv zamp_venv                 # skip if zamp_venv/ already exists
./zamp_venv/bin/python -m pip install -r backend/requirements.txt

# Optional: OCR for scanned invoices (Ubuntu/Debian/WSL)
sudo apt-get install -y tesseract-ocr

# Dashboard dependencies
cd frontend
npm install
cd ..
```

### 3. Configure

The backend reads **exported shell variables** and does not load `.env`
files:

| Variable | Required | Purpose |
| --- | --- | --- |
| `BACKEND_API_KEY` | Recommended | Application key every API call must send as `X-API-Key` |
| `OPENAI_API_KEY` | For extraction | Model provider credential |
| `EXTRACTION_MODEL` | For extraction | Model ID with JSON-schema structured output |
| `OPENAI_BASE_URL` | No | OpenAI-compatible endpoint for unprefixed models |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | For prefixed models | Credentials for `gemini:` / `groq:` model entries |
| `EXTRACTION_FALLBACK_MODELS` | No | Comma-separated models tried when the main one is overloaded or out of quota |
| `EXTRACTION_PROVIDER_RETRIES` | No | Retries per model for 429, 5xx and timeouts (default `0`) |
| `EXTRACTION_RETRY_BACKOFF_SECONDS` | No | First retry delay; doubles each retry (default `2`) |
| `PROCESSING_DB` | No | SQLite path (default `backend/runtime/processing.sqlite3`) |
| `PROCUREMENT_PATH` | No | Trusted vendor/PO/policy file (default `backend/procurement.json`) |
| `CORS_ORIGINS` | No | Only needed when the dashboard calls the backend directly |
| `WORKER_ENABLED` | No | `true` (default) runs the processing worker in the API process |
| `RESET_ON_START` | No | `true` wipes all processed cases, audit history, PO reservations each time the backend starts. Default `true`; set `false` to retain processing history |
| `APPROVED_EXPORT_PATH` | No | Where the approved-invoice Excel is kept up to date (default `exports/approved_invoices.xlsx` beside the database) |

The dashboard reads `frontend/.env`, or the shell, for its proxy:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_URL` | `http://127.0.0.1:8000` | Where the proxy forwards API calls |
| `BACKEND_API_KEY` | (empty) | Must equal the backend's `BACKEND_API_KEY`. The proxy adds it server-side, so it never reaches the browser |

```bash
cp frontend/.env.example frontend/.env    # then set BACKEND_API_KEY in it
```

#### Provider configuration and fallback

Unprefixed model IDs use `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`.
Prefix a model with `gemini:` or `groq:` to use that provider's endpoint and
its own `GEMINI_API_KEY` or `GROQ_API_KEY`. Entries without the corresponding
provider key are skipped. Set model IDs available to your account that support
native JSON-schema structured output and temperature 0.

```bash
export GEMINI_API_KEY='your-gemini-key'
export GROQ_API_KEY='your-groq-key'
export EXTRACTION_MODEL='gemini:your-model-id'
export EXTRACTION_FALLBACK_MODELS='groq:your-model-id'
export EXTRACTION_PROVIDER_RETRIES=3
export EXTRACTION_RETRY_BACKOFF_SECONDS=5
```

Fallbacks run in order after transient provider failures (429, 5xx,
timeouts), a provider HTTP 413 (request too large), a reply cut off at the
output-token limit, or a provider rejecting the model's output against the
schema (Groq HTTP 400). Our own schema-validation failures retry once on the
same model and then go to review. Quotas,
model access and billing depend on your provider account; check your account
before sending invoices. Keep credentials out of Git.

### 4. Start

**Provider startup helper:** `./backend/start.sh` loads
`~/.config/zamp/gemini.key` and `~/.config/zamp/groq.key`, defaults to a
Gemini/Groq model chain, clears `OPENAI_API_KEY` and
`OPENAI_BASE_URL`, and resets processed cases on each start (run it as
`RESET_ON_START=false ./backend/start.sh` to keep them). It prints which keys
were found, never their values. Override `EXTRACTION_MODEL` and
`EXTRACTION_FALLBACK_MODELS` with model IDs
available to your account. The manual start below also resets by default; add
`export RESET_ON_START=false` to keep cases.

**Terminal 1, the backend:**

```bash
export BACKEND_API_KEY=dev-app-key
export OPENAI_API_KEY=sk-...              # optional, enables extraction
export EXTRACTION_MODEL=your-model-id     # optional, enables extraction
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Keep `--workers 1`: a single worker process owns the processing database.

Processed cases and uploaded PDFs live in `backend/runtime/processing.sqlite3`.
Every backend worker startup clears processing state by default, including
results, audit history, PO reservations. Set `RESET_ON_START=false` explicitly
to retain them. `test_cases/` is never modified by the reset.

On the dashboard home page, **Refresh & start fresh** performs the same reset
without restarting the backend and reloads all dashboard queries, including
Reference data. An active extraction
finishes before reset clears its case. Trusted vendor/PO/FX configuration in
`PROCUREMENT_PATH` is retained: these records are needed to validate new invoices.
The dashboard shows both unique case counts and distinct inbox email outcomes;
identical attachments share a case, but count as duplicate email submissions.

**Terminal 2, the dashboard:**

```bash
cd frontend
BACKEND_API_KEY=dev-app-key npm run dev   # or rely on frontend/.env
```

| URL | What |
| --- | --- |
| http://localhost:5173 | **The dashboard** |
| http://127.0.0.1:8000/docs | Interactive API documentation (Swagger) |
| http://127.0.0.1:8000/ | Legacy read-only inbox page. Works only when `BACKEND_API_KEY` is unset; otherwise it shows `UNAUTHORIZED`, because a browser page cannot send the key. Use the dashboard |
| http://127.0.0.1:8000/health | Backend health JSON |

### 5. First run walkthrough

1. Open http://localhost:5173. The sidebar footer should show *Backend
   online* and *Worker running*.
2. Go to **Settings** and enter your name. There is no reviewer key: anyone
   using the dashboard can correct, approve and retry cases, and the name is
   recorded with each action in the audit trail and the Excel export.
3. Go to **Inbox**, pick an email and click **Send to processing**. Click the
   case link in the confirmation.
4. The case page refreshes itself while the case is *Queued* or *Processing*.
   It then shows the decision.
5. The **Summary** tab shows the key facts, why the case was approved or held
   (in plain language), and the invoice next to its purchase order. If it is
   **Needs review**, click **Compare with PDF & resolve** (see below).

### 6. Dashboard features

**Dashboard** (`/`)
- Case counts by status: queued, processing, needs review, approved and
  duplicate. Each tile opens the filtered case list.
- The latest five cases waiting for review and the latest five cases overall.
- Warnings when extraction is not configured or the worker is stopped.
- **Refresh & start fresh**, the **Approved invoices (Excel)** download, and
  shortcuts to the inbox and to upload.

**Cases** (`/cases`)
- Every case, newest first, with status tabs and counts.
- Columns: status, invoice number and file, vendor, PO, amount, first finding.
- 25 cases per page; the filter and page are kept in the URL, so links can be
  shared.
- The list refreshes every few seconds while any case on screen is still
  processing.

**Case detail** (`/cases/<id>`)
- **Header:** vendor and invoice number with the status, then the source
  email, file name, received time, case ID and version. The open tab is kept
  in the URL (`?tab=review` opens Compare & resolve), so links can be shared.
- **Summary tab:** vendor, what was bought, amount, PO and dates first; then
  why the case was approved (a checklist) or held (numbered issues, each with
  what's wrong, why it matters and what to do); then the invoice and the
  PO/vendor record side by side; then line items; then every verified field
  with its confidence and evidence.
- **Compare & resolve tab:** the invoice PDF on the left and the purchase
  order on the right. Values that differ from the PO or vendor record (vendor,
  bank account, available balance) are shown in red. If the PO can't be found,
  the panel says why and lists the vendor's POs to pick from.
- **Resolve a case in review** with one of:
  - **Correct values & re-check:** fix misread values or fill in missing
    ones; every rule reruns (see the review workflow below).
  - **Approve manually:** for when you have checked it yourself. Tick every
    open issue, write why it is OK to pay, and confirm. The PO value is still
    reserved and the override is recorded in the audit trail. Not available
    while nothing could be read from the PDF.
  - **Retry processing:** only when the case stopped on a processing
    dependency (`OCR_UNAVAILABLE`, `OCR_FAILED`, `EXTRACTION_NOT_CONFIGURED`,
    `EXTRACTION_SCHEMA_FAILED` or `PROCESSING_ERROR`). Fix the backend first,
    then retry with a note.
- **Approved invoices (Excel):** the download button on the Dashboard and
  Cases pages gives an `.xlsx` register of every approved invoice, generated
  from current data on each click. Sheets: *Summary* (totals by currency and
  vendor), *Approved invoices* (one row per invoice: approval time and type,
  approver, vendor, invoice and PO numbers, dates, amounts, amount charged to
  the PO, both bank accounts, reviewer note and overridden issues; manual
  approvals highlighted) and *Line items*. The backend also rewrites a copy at
  `backend/runtime/exports/approved_invoices.xlsx` after every approval and
  reset (set `APPROVED_EXPORT_PATH` to put it elsewhere, e.g. a shared folder).
  API: `GET /api/v1/exports/approved-invoices.xlsx`.
- **Checks tab:** every rule result (evidence, PO balance, FX, duplicate
  candidates, rule version), plus the raw JSON.
- **Source text tab:** the text of each page, whether it came from digital
  text or OCR, and the OCR confidence (85 or above is required).
- **Audit trail tab:** an append-only timeline of ingestion, parsing,
  extraction, each validation stage (passed or findings), human corrections,
  manual approvals, retries and decisions, with the reviewer's name. Each event
  has a details view.
- **Policy snapshot tab:** the procurement data and policy in force when the
  decision was made.
- Bundled PDFs (several invoices in one file) cannot be corrected or approved
  manually. Split the PDF and upload each document separately.

**Inbox** (`/inbox`)
- The 50 sample vendor emails, with search by sender or subject.
- The message body, the attached invoice PDF and a download of the original
  `.eml`.
- **Send to processing** creates a case. Sending the same PDF again reuses
  the existing case and records the extra submission.

**Upload** (`/upload`)
- Drag and drop, or choose `.pdf` files (up to 20 MiB) or `.eml` emails (up
  to 40 MiB, with at most 20 PDF attachments; each PDF becomes its own case).
- An optional sender address for PDFs, recorded for provenance only.
- Results link straight to each new case. Identical files are never
  processed or reserved twice.

**Reference data** (`/references`), read-only
- **Vendors:** ID, name, domain, approval, payment terms, currency and bank
  account.
- **Purchase orders:** amount, received amount, previously invoiced,
  tolerance and issue date.
- **FX rates:** the approved dated conversion rates.
- **Policy:** evaluation date, invoice age limit, amount tolerance, and the
  bank-change and adjustment actions.

**Settings** (`/settings`)
- Your name, remembered in this browser and recorded with each review action.
- Light, dark or system theme.
- Backend status: worker, extraction configuration and API base.

### 7. Review workflow (correcting a case)

1. Open a case in **Needs review**, go to **Compare & resolve** and choose
   **Correct values & re-check**.
2. Every field is editable, with its original confidence and evidence shown
   below it. Fields named in findings are marked *flagged*; important values
   that are empty are marked *missing*. Picking a PO in the right-hand panel
   fills in the PO reference.
3. Edit values. An empty box is sent as an explicit `null`. Amounts must be
   plain decimals such as `1234.50`. Line items and tax components can be
   added or removed.
4. Enter your name, write a note (at least 5 characters) and tick the
   attestation: you checked **every** field against the PDF.
5. Click **Save corrections & re-check**. The backend reruns validation, vendor and bank checks, duplicate
   detection, PO matching, math, dates, FX and balances. The case becomes
   **approved**, stays in **review** with the remaining findings, or becomes
   a **duplicate**. Corrections never rerun OCR or the model.
6. If someone else changed the case first, you will see a *409 conflict*.
   Click **Refresh** and redo the edit.

A correction cannot waive business failures such as an unapproved vendor, a
changed bank account, an unknown PO, an exceeded PO balance or wrong math. It
only fixes misread data. To accept such a case after checking it yourself, use
**Approve manually** instead.

**Approving manually**

1. On **Compare & resolve**, choose **Approve manually**.
2. Tick every open issue. High-risk issues (bank change, duplicate, PO
   overrun, unknown vendor) carry a warning: confirm them with the vendor or
   requester through a channel you already trust.
3. Enter your name, write why it is OK to pay (at least 10 characters) and
   confirm you compared the invoice with the PDF and the PO yourself.
4. The case becomes **Approved** without re-running any checks or changing any
   values. The Summary tab shows *Approved manually* with your note and the
   issues you accepted, the PO value is reserved, and the Excel row is
   highlighted.

### 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Sidebar shows *Backend unreachable* | Start the backend on port 8000, or set `BACKEND_URL` |
| Errors mention `401` / `X-API-Key` | The dashboard's `BACKEND_API_KEY` differs from the backend's; set the same value and restart `npm run dev` |
| Review buttons stay disabled | Enter your name (at least 2 characters) in the form or in Settings |
| Every case shows `EXTRACTION_NOT_CONFIGURED` | Set `EXTRACTION_MODEL` and its provider key, restart the backend, then use **Retry processing** |
| Scanned invoices show `OCR_UNAVAILABLE` | Install `tesseract-ocr`, restart the backend, then retry |
| Cases stay *Queued* | The worker is not running: check `WORKER_ENABLED` and that only one backend process uses the database |
| Backend refuses to start a second worker | Only one process may own a processing database; stop the other one |
| Port 5173 already in use | `npm run dev -- --port 5174` |
| **Approve manually** or the Excel download fails with `404` | The backend is older than the dashboard; restart it (`RESET_ON_START=false ./backend/start.sh` keeps cases) |

### 9. Production build

```bash
cd frontend && npm run build              # static files in frontend/dist
```

Serve `frontend/dist` behind a reverse proxy. It must fall back to
`index.html` for unknown routes, forward `/api`, `/emails`, `/vendors`,
`/purchase-orders` and `/health` to the backend, and add `X-API-Key`
server-side. Run the backend as described in
[the backend guide](backend/README.md), which also covers Docker. The
frontend's architecture and how to add screens are in
[the frontend guide](frontend/README.md).

## Tests

Backend tests and sample-input checks:

```bash
RESET_ON_START=false ./zamp_venv/bin/python -m unittest discover -s test_cases -v
./zamp_venv/bin/python -m unittest backend.test_reset backend.test_audit_fixes -v
./zamp_venv/bin/python -m test_cases.validate_inbox
./zamp_venv/bin/python -m backend.export_openapi
```

**Live end-to-end audit.** `backend/audit_inbox.py` runs the real PDF/OCR and
model pipeline over all 50 inbox emails in a separate database, then compares
the outcomes with the labels (labels are read only after processing). It uses
provider quota: export the provider keys and model chain first (as
`./backend/start.sh` does), then:

```bash
./zamp_venv/bin/python -m backend.audit_inbox --output backend/runtime/audit --workers 1
```

Extractions are cached per email in the output folder, so a rerun only calls
the model for emails that are missing or failed. The run on 2026-11-08 with the
Gemini/Groq chain matched all 50 labels (40 approved, 8 review, 2 duplicate).
Model output varies between runs and providers, so treat this as a spot check,
not a guarantee.

Dashboard tests, type check and build:

```bash
cd frontend
npm test
npm run build
npm run gen:api     # after backend API changes: regenerate types, then npm run typecheck
```

Generate sample inputs with `./zamp_venv/bin/python -m test_cases.generate_inbox`.
The generator refuses to overwrite an existing inbox database. See the
[fixture guide](test_cases/test_inputs/README.md) and
[edge cases](test_cases/EDGE_CASES.md) for dataset details.

All fixture identities and documents are fictional. No emails are sent.
Expected fixture outcomes are reference labels and are never read by the
processing backend; only the separate audit tool compares against them.
