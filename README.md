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
  schemas.py             Extraction and API schemas
  database.py            SQLite persistence and audit storage
  settings.py            Environment configuration and repository paths
  procurement.json       Trusted synthetic procurement master and policy
  requirements.txt       Python dependencies
  start.sh               Local provider startup helper
  Dockerfile             Container build with Tesseract OCR
  .env.example           Environment configuration example
  README.md              Setup, API integration and operational guide
  openapi.json           Exported frontend API contract
  export_openapi.py      API contract export utility
  runtime/               Local processing data (ignored by Git)
frontend/                React + TypeScript review app (see frontend/README.md)
  src/                   API client, feature modules, shared components
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
3. LangChain and an OpenAI-compatible model extract structured facts. The
   model only extracts; it never decides.
4. Deterministic Python validates the facts, checks the vendor and bank
   details, detects duplicates, matches the PO, checks the math, dates, FX and
   GST, then decides.
5. The case ends as **approved** (PO value reserved locally), **duplicate**,
   or **review**, held for a human.
6. A reviewer corrects the extracted data in the dashboard. Every rule reruns
   on the corrected data; a reviewer can never force-approve.

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
| `REVIEWER_API_KEY` | Yes, for corrections and retries | Key a reviewer enters in the dashboard |
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
| `RESET_ON_START` | No | `true` wipes all processed cases, audit history and PO reservations each time the backend starts. Development only; default `false` |

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

Fallbacks run in order after transient provider failures or a provider HTTP 413
(request too large). Schema failures do not trigger another model. Quotas,
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
available to your account. The manual start below preserves cases by default.

**Terminal 1, the backend:**

```bash
export BACKEND_API_KEY=dev-app-key
export REVIEWER_API_KEY=dev-reviewer-key
export OPENAI_API_KEY=sk-...              # optional, enables extraction
export EXTRACTION_MODEL=your-model-id     # optional, enables extraction
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Keep `--workers 1`: a single worker process owns the processing database.

Processed cases are saved in `backend/runtime/processing.sqlite3` and survive
restarts. To start from a clean slate on every restart, add
`export RESET_ON_START=true` before starting the backend. This clears only the
processing database; the sample inbox in `test_cases/test_inputs/` and
`backend/procurement.json` are never changed.

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
2. Go to **Settings** and enter the reviewer key (`dev-reviewer-key` above).
   The footer then shows *Reviewer key set*.
3. Go to **Inbox**, pick an email and click **Send to processing**. Click the
   case link in the confirmation.
4. The case page refreshes itself while the case is *Queued* or *Processing*.
   It then shows the decision.
5. If it is **Needs review**, read the findings, compare the extracted data
   with the PDF on the right, then click **Correct & revalidate** (see below).

### 6. Dashboard features

**Dashboard** (`/`)
- Case counts by status: queued, processing, needs review, approved and
  duplicate. Each tile opens the filtered case list.
- The latest five cases waiting for review and the latest five cases overall.
- Warnings when extraction is not configured or the worker is stopped.
- Shortcuts to the inbox and to upload.

**Cases** (`/cases`)
- Every case, newest first, with status tabs and counts.
- Columns: status, invoice number and file, vendor, PO, amount, first finding.
- 25 cases per page; the filter and page are kept in the URL, so links can be
  shared.
- The list refreshes every few seconds while any case on screen is still
  processing.

**Case detail** (`/cases/<id>`)
- **Header and summary:** status, version, vendor, sender, file, PO, amount,
  invoice date, timestamps, source email and file hash.
- **Decision banner:** the outcome and the deterministic explanation.
- **Review tab:**
  - findings, each with its code, the stage that raised it and the field;
  - all extracted fields with value, confidence (high, medium or low),
    verbatim evidence and page number, with flagged fields highlighted;
  - line items and GST tax components;
  - the source PDF shown alongside.
- **Correct & revalidate** (cases in review only): see the review workflow
  below.
- **Retry processing:** appears only when the case stopped on a processing
  dependency (`OCR_UNAVAILABLE`, `OCR_FAILED`, `EXTRACTION_NOT_CONFIGURED`,
  `EXTRACTION_SCHEMA_FAILED` or `PROCESSING_ERROR`). Fix the backend first,
  then retry with a note.
- **Checks tab:** every rule result (evidence, PO balance, FX, duplicate
  candidates, rule version), plus the raw JSON.
- **Source text tab:** the text of each page, whether it came from digital
  text or OCR, and the OCR confidence (85 or above is required).
- **Audit trail tab:** an append-only timeline of ingestion, parsing,
  extraction, each validation stage (passed or findings), human corrections,
  retries and decisions. Each event has a details view.
- **Policy snapshot tab:** the procurement data and policy in force when the
  decision was made.
- Bundled PDFs (several invoices in one file) are shown per document and
  cannot be corrected. Split the PDF and upload each document separately.

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
- The reviewer key, kept for the browser tab only and cleared when it closes.
- Light, dark or system theme.
- Backend status: worker, extraction configuration and API base.

### 7. Review workflow (correcting a case)

1. Open a case in **Needs review** and click **Correct & revalidate**.
2. Every field is editable, with its original confidence and evidence shown
   below it. Fields named in findings are marked *flagged*.
3. Edit values. An empty box is sent as an explicit `null`. Amounts must be
   plain decimals such as `1234.50`. Line items and tax components can be
   added or removed.
4. Write a reviewer note (at least 5 characters) and tick the attestation:
   you checked **every** field against the PDF.
5. Submit. The backend reruns validation, vendor and bank checks, duplicate
   detection, PO matching, math, dates, FX and balances. The case becomes
   **approved**, stays in **review** with the remaining findings, or becomes
   a **duplicate**. Corrections never rerun OCR or the model.
6. If someone else changed the case first, you will see a *409 conflict*.
   Click **Refresh** and redo the edit.

A correction cannot waive business failures such as an unapproved vendor, a
changed bank account, an unknown PO, an exceeded PO balance or wrong math. It
only fixes misread data.

### 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Sidebar shows *Backend unreachable* | Start the backend on port 8000, or set `BACKEND_URL` |
| Errors mention `401` / `X-API-Key` | The dashboard's `BACKEND_API_KEY` differs from the backend's; set the same value and restart `npm run dev` |
| Correction or retry fails with `403` | Wrong reviewer key; update it in Settings |
| Correction or retry fails with `503` | `REVIEWER_API_KEY` is not set on the backend |
| Every case shows `EXTRACTION_NOT_CONFIGURED` | Set `EXTRACTION_MODEL` and its provider key, restart the backend, then use **Retry processing** |
| Scanned invoices show `OCR_UNAVAILABLE` | Install `tesseract-ocr`, restart the backend, then retry |
| Cases stay *Queued* | The worker is not running: check `WORKER_ENABLED` and that only one backend process uses the database |
| Backend refuses to start a second worker | Only one process may own a processing database; stop the other one |
| Port 5173 already in use | `npm run dev -- --port 5174` |

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
./zamp_venv/bin/python -m unittest discover -s test_cases -v
./zamp_venv/bin/python -m test_cases.validate_inbox
./zamp_venv/bin/python -m backend.export_openapi
```

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
Expected fixture outcomes are reference labels, not measured live extraction
performance; expected outcomes are never read by the processing backend.
