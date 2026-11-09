# Invoice processing

An invoice review system for accounts payable. It reads invoice PDFs that
arrive by email or upload, uses an AI model to **extract** the facts, and then
uses plain, deterministic rules to **decide**: approve the invoice against its
purchase order, flag it as a duplicate, or hold it for a person to review in a
web dashboard.

- **Backend:** Python, FastAPI, SQLite, Tesseract OCR, LangChain with Gemini
  and Groq models.
- **Dashboard:** React and TypeScript.
- **Sample data:** a 50-email vendor inbox with realistic invoices and edge
  cases. All companies and people in it are fictional.

Nothing here pays an invoice or sends an email.

## Contents

1. [Quick start](#quick-start)
2. [How it works](#how-it-works)
3. [Using the dashboard](#using-the-dashboard)
4. [Reviewing a held case](#reviewing-a-held-case)
5. [Configuration](#configuration)
6. [Running the parts separately](#running-the-parts-separately)
7. [Data and resets](#data-and-resets)
8. [Troubleshooting](#troubleshooting)
9. [Tests](#tests)
10. [Production build](#production-build)
11. [Project layout](#project-layout)

## Quick start

Run all commands from the repository root on Linux or WSL.

### 1. Install the prerequisites

| Tool | Needed for | Check |
| --- | --- | --- |
| Python 3.11+ | Backend | `python3 --version` |
| Node.js 20+ and npm | Dashboard | `node -v && npm -v` |
| Tesseract OCR (recommended) | Scanned or image-only PDFs | `tesseract --version` |
| A Gemini and/or Groq API key | Reading invoices automatically | Free-tier keys from Google AI Studio and GroqCloud |

```bash
sudo apt-get install -y tesseract-ocr     # Ubuntu/Debian/WSL
```

The app still runs without these two. Without Tesseract, scanned invoices
stop in review with `OCR_UNAVAILABLE`. Without a key, every invoice stops in
review with `EXTRACTION_NOT_CONFIGURED`. Both kinds of case can be retried
once the missing piece is in place.

### 2. Save your API keys (once)

The keys live in files outside the repository, so they never end up in Git.
Each command asks for a key without showing it on screen or saving it in your
shell history:

```bash
mkdir -p ~/.config/zamp && chmod 700 ~/.config/zamp
read -rsp 'Gemini key: ' k && printf '%s' "$k" > ~/.config/zamp/gemini.key; echo
read -rsp 'Groq key: '   k && printf '%s' "$k" > ~/.config/zamp/groq.key;   echo
chmod 600 ~/.config/zamp/*.key; unset k
```

One provider is enough: models from a provider without a key are skipped. To
keep the files somewhere else, set `ZAMP_KEY_DIR`.

### 3. Run

```bash
./run.sh
```

That one command:

1. Creates the Python environment (`zamp_venv/`) and installs the backend and
   dashboard dependencies, if they are missing.
2. Checks for your key files, Tesseract, and free ports 8000 and 5173.
3. Ignores leftover placeholder or OpenAI variables in your shell (see
   [Troubleshooting](#troubleshooting)).
4. Starts the backend through `backend/start.sh` and waits until it is
   healthy.
5. Starts the dashboard with the same application key.

The first run takes a few minutes while dependencies install. After that it
starts in seconds. Output from both processes appears in the same terminal,
prefixed `[backend]` and `[frontend]`. Press **Ctrl+C** to stop both.

You should see:

```text
[backend]  Provider keys:
[backend]    GEMINI_API_KEY: loaded from /home/<you>/.config/zamp/gemini.key
[backend]    GROQ_API_KEY: loaded from /home/<you>/.config/zamp/groq.key
[backend]  Model chain: gemini:gemini-3.5-flash,groq:openai/gpt-oss-120b,...

  Dashboard   http://localhost:5173
  API docs    http://127.0.0.1:8000/docs
  Health      http://127.0.0.1:8000/health
```

Each start clears the previous run's processed cases. To keep them, run:

```bash
RESET_ON_START=false ./run.sh
```

The sample inputs in `test_cases/` are never modified.

### 4. Process your first invoice

1. Open http://localhost:5173. The sidebar footer should show *Backend
   online* and *Worker running*.
2. Go to **Settings** and enter your name. It is recorded with every review
   action in the audit trail and the Excel export.
3. Go to **Inbox**, pick an email and click **Send to processing**, then open
   the case link in the confirmation.
4. The case page refreshes itself while the case is *Queued* or
   *Processing*, then shows the decision.
5. The **Summary** tab explains in plain language why the case was approved
   or held. If it says **Needs review**, see
   [Reviewing a held case](#reviewing-a-held-case).

## How it works

```text
 PDF / .eml / inbox email
          │
          ▼
 Read every page ── digital text, or Tesseract OCR for scans
          │
          ▼
 AI model extracts facts ── Gemini first, Groq and other Gemini models as fallbacks
          │                 (the model only extracts; it never decides)
          ▼
 Deterministic rules ── vendor & bank details, duplicates, PO match,
          │             math, dates, FX, GST, PO balance
          ▼
 approved  ·  duplicate  ·  review (held for a person)
```

1. An invoice PDF arrives from the vendor inbox, a PDF upload or an `.eml`
   upload.
2. The backend reads every page, using digital text or Tesseract OCR for
   scans. OCR output is rebuilt into visual rows, so a label and its value
   ("Issued 2026-10-18") stay on one line.
3. LangChain sends the page text to a structured-output model, which returns
   each field with its confidence and the exact text it came from.
4. Python rules validate those facts against the trusted vendor, purchase
   order (PO) and FX data in `backend/procurement.json`, then decide.
5. The case ends as **approved** (the PO value is reserved locally),
   **duplicate**, or **review**.
6. A reviewer compares a held invoice with its PO in the dashboard. They
   either correct misread data, which reruns every rule, or approve it
   manually after checking it by eye. A manual approval must acknowledge every
   open issue and is recorded in the audit trail.
7. Every approved invoice is added to an Excel register. You can download it
   from the dashboard, and the backend keeps a copy up to date on disk.

## Using the dashboard

**Dashboard** (`/`)
- Case counts by status: queued, processing, needs review, approved and
  duplicate. Each tile opens the filtered case list.
- The latest five cases waiting for review and the latest five cases overall.
- Warnings when extraction is not configured or the worker is stopped.
- **Refresh & start fresh** (see [Data and resets](#data-and-resets)), the
  **Approved invoices (Excel)** download, and shortcuts to the inbox and to
  upload.

**Cases** (`/cases`)
- Every case, newest first, with status tabs and counts.
- Columns: status, invoice number and file, vendor, PO, amount, first finding.
- 25 cases per page. The filter and page are kept in the URL, so links can be
  shared.
- The list refreshes every few seconds while any case on screen is still
  processing.

**Case detail** (`/cases/<id>`)
- **Header:** vendor and invoice number with the status, then the source
  email, file name, received time, case ID and version. The open tab is kept
  in the URL (`?tab=review` opens Compare & resolve), so links can be shared.
- **Summary:** vendor, what was bought, amount, PO and dates first. Then why
  the case was approved (a checklist) or held (numbered issues, each with
  what's wrong, why it matters and what to do). Then the invoice and the
  PO/vendor record side by side, the line items, and every verified field with
  its confidence and evidence.
- **Compare & resolve:** the invoice PDF on the left and the purchase order on
  the right. Values that differ from the PO or vendor record (vendor, bank
  account, available balance) are shown in red. If the PO can't be found, the
  panel says why and lists the vendor's POs to pick from.
- **Checks:** every rule result (evidence, PO balance, FX, duplicate
  candidates, rule version), plus the raw JSON.
- **Source text:** the text of each page, whether it came from digital text or
  OCR, and the OCR confidence (85 or above is required).
- **Audit trail:** an append-only timeline of ingestion, parsing, extraction,
  each validation stage, human corrections, manual approvals, retries and
  decisions, with the reviewer's name. Each event has a details view.
- **Policy snapshot:** the procurement data and policy in force when the
  decision was made.

**Inbox** (`/inbox`)
- The 50 sample vendor emails, with search by sender or subject.
- The message body, the attached invoice PDF and a download of the original
  `.eml`.
- **Send to processing** creates a case. Sending the same PDF again reuses the
  existing case and records the extra submission.

**Upload** (`/upload`)
- Drag and drop, or choose `.pdf` files (up to 20 MiB) or `.eml` emails (up to
  40 MiB, with at most 20 PDF attachments; each PDF becomes its own case).
- An optional sender address for PDFs, recorded for provenance only.
- Results link straight to each new case. Identical files are never processed
  or reserved twice.

**Reference data** (`/references`, read-only)
- **Vendors:** ID, name, domain, approval, payment terms, currency and bank
  account.
- **Purchase orders:** amount, received amount, previously invoiced, tolerance
  and issue date.
- **FX rates:** the approved dated conversion rates.
- **Policy:** evaluation date, invoice age limit, amount tolerance, and the
  bank-change and adjustment actions.

**Settings** (`/settings`)
- Your name, remembered in this browser and recorded with each review action.
- Light, dark or system theme.
- Backend status: worker, extraction configuration and API base.

**Approved invoices (Excel)**

The download button on the Dashboard and Cases pages gives an `.xlsx` register
of every approved invoice, generated from current data on each click. It has
three sheets:

| Sheet | Contents |
| --- | --- |
| *Summary* | Counts, manual approvals, totals by currency and by vendor |
| *Approved invoices* | One row per invoice: approval time and type (automatic or manual), approver, vendor, invoice and PO numbers, dates, amounts, amount charged to the PO, the bank account on the vendor record **and** on the invoice, reviewer note and overridden issues. Manual approvals are highlighted |
| *Line items* | Every line of every approved invoice |

The backend also rewrites a copy at
`backend/runtime/exports/approved_invoices.xlsx` after every approval and
reset. Set `APPROVED_EXPORT_PATH` to keep it somewhere else, such as a shared
folder. API: `GET /api/v1/exports/approved-invoices.xlsx`.

## Reviewing a held case

There is no reviewer login: anyone using the dashboard can resolve cases, and
the name from **Settings** is recorded with each action. Open a case in
**Needs review**, go to **Compare & resolve**, and pick one of three actions.

| Action | Use it when | What happens |
| --- | --- | --- |
| **Correct values & re-check** | The model misread or missed a value | Every rule reruns on your corrected data |
| **Approve manually** | You checked the invoice yourself and accept the open issues | Approved as is; your note and the accepted issues are recorded |
| **Retry processing** | The case stopped on a processing problem: `OCR_UNAVAILABLE`, `OCR_FAILED`, `EXTRACTION_NOT_CONFIGURED`, `EXTRACTION_SCHEMA_FAILED` or `PROCESSING_ERROR` | OCR and extraction run again. Fix the cause first, then retry with a note |

Bundled PDFs (several invoices in one file) can't be corrected or approved
manually. Split the PDF and upload each document separately.

### Correct values & re-check

1. Choose **Correct values & re-check**.
2. Every field is editable, with its original confidence and evidence shown
   below it. Fields named in findings are marked *flagged*. Important values
   that are empty are marked *missing*. Picking a PO in the right-hand panel
   fills in the PO reference.
3. Edit values. An empty box is sent as an explicit `null`. Amounts must be
   plain decimals such as `1234.50`. Line items and tax components can be added
   or removed.
4. Enter your name, write a note (at least 5 characters) and tick the
   attestation that you checked **every** field against the PDF.
5. Click **Save corrections & re-check**. The backend reruns validation,
   vendor and bank checks, duplicate detection, PO matching, math, dates, FX
   and balances. The case becomes **approved**, stays in **review** with the
   remaining findings, or becomes a **duplicate**. Corrections never rerun OCR
   or the model.
6. If someone else changed the case first, you'll see a *409 conflict*. Click
   **Refresh** and redo the edit.

A correction only fixes misread data. It can't waive business failures such as
an unapproved vendor, a changed bank account, an unknown PO, an exceeded PO
balance or wrong math. To accept such a case after checking it yourself, use
**Approve manually**.

### Approve manually

1. Choose **Approve manually**.
2. Tick every open issue. High-risk issues (bank change, duplicate, PO
   overrun, unknown vendor) carry a warning: confirm them with the vendor or
   requester through a channel you already trust.
3. Enter your name, write why it is OK to pay (at least 10 characters) and
   confirm that you compared the invoice with the PDF and the PO yourself.
4. The case becomes **Approved** without rerunning any checks or changing any
   values. The Summary tab shows *Approved manually* with your note and the
   accepted issues, the PO value is reserved, and the Excel row is
   highlighted.

Manual approval isn't available while nothing could be read from the PDF.

## Configuration

`run.sh` and `backend/start.sh` set sensible defaults, so most people never
need this section.

### Model chain

Invoices are sent to the first model. If it fails in a recoverable way, the
next one is tried.

| Order | Model | Variable |
| --- | --- | --- |
| 1 | `gemini:gemini-3.5-flash` | `EXTRACTION_MODEL` |
| 2 | `groq:openai/gpt-oss-120b` | `EXTRACTION_FALLBACK_MODELS` |
| 3 | `gemini:gemini-3-flash-preview` | `EXTRACTION_FALLBACK_MODELS` |
| 4 | `gemini:gemini-3.5-flash-lite` | `EXTRACTION_FALLBACK_MODELS` |
| 5 | `groq:qwen/qwen3.8-27b` | `EXTRACTION_FALLBACK_MODELS` |

The `gemini:` or `groq:` prefix picks the provider and its key
(`GEMINI_API_KEY` or `GROQ_API_KEY`). A model ID **without** a prefix would go
to OpenAI with `OPENAI_API_KEY`. This setup never does that: both startup
scripts clear the OpenAI variables, so nothing is billed to OpenAI by accident.

The next model is tried after:
- a transient provider failure (429, 5xx or timeout), once the
  `EXTRACTION_PROVIDER_RETRIES` retries on the current model are used up;
- a `Retry-After` hint longer than 60 seconds, such as an exhausted daily
  quota (no waiting);
- a request too large for the model (HTTP 413);
- a reply cut off at the output-token limit;
- the provider rejecting the output against the schema (Groq HTTP 400).

Our own schema-validation failures retry once on the same model and then go to
review. Quotas and model access depend on your provider account.

### Backend variables

The backend reads **exported shell variables only**; it does not load `.env`
files. Defaults marked *(start.sh)* are filled in by the startup scripts.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_API_KEY` | `dev-app-key` (start.sh) | Application key every API call must send as `X-API-Key` |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | from `~/.config/zamp/*.key` (start.sh) | Credentials for `gemini:` / `groq:` models |
| `EXTRACTION_MODEL` | `gemini:gemini-3.5-flash` (start.sh) | First model in the chain |
| `EXTRACTION_FALLBACK_MODELS` | the chain above (start.sh) | Comma-separated models tried in order |
| `EXTRACTION_PROVIDER_RETRIES` | `3` (start.sh), else `0` | Retries per model for 429, 5xx and timeouts |
| `EXTRACTION_RETRY_BACKOFF_SECONDS` | `5` (start.sh), else `2` | First retry delay; doubles each retry |
| `RESET_ON_START` | `true` | Wipes processed cases, audit history and PO reservations on each start. Set `false` to keep them |
| `PROCESSING_DB` | `backend/runtime/processing.sqlite3` | SQLite database path |
| `APPROVED_EXPORT_PATH` | `exports/approved_invoices.xlsx` beside the database | Where the approved-invoice Excel is kept up to date |
| `PROCUREMENT_PATH` | `backend/procurement.json` | Trusted vendor, PO, FX and policy data |
| `WORKER_ENABLED` | `true` | Runs the processing worker inside the API process |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Only needed when a browser calls the backend directly |
| `ZAMP_KEY_DIR` | `~/.config/zamp` | Where the startup scripts look for key files |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | unset (cleared by the scripts) | Only for unprefixed model IDs. Not used by this setup |

### Dashboard variables

The dashboard's dev proxy reads these from `frontend/.env` or the shell.
`run.sh` passes the key for you.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_URL` | `http://127.0.0.1:8000` | Where the proxy forwards API calls |
| `BACKEND_API_KEY` | (empty) | Must equal the backend's `BACKEND_API_KEY` (`dev-app-key` by default). The proxy adds it server-side, so it never reaches the browser |

## Running the parts separately

`run.sh` is the easiest way to start. To run the backend and dashboard in your
own terminals instead (for example, to restart only one of them), first
install the dependencies once:

```bash
python3 -m venv zamp_venv
./zamp_venv/bin/python -m pip install -r backend/requirements.txt
(cd frontend && npm install)
cp frontend/.env.example frontend/.env    # then set BACKEND_API_KEY=dev-app-key in it
```

**Terminal 1, the backend:**

```bash
./backend/start.sh                        # RESET_ON_START=false ./backend/start.sh keeps cases
```

> **Start from a clean terminal.** Variables already exported in your shell
> take priority over `start.sh`'s defaults. If you exported example values
> earlier, such as `EXTRACTION_MODEL=your-model-id` or `OPENAI_API_KEY=sk-...`,
> every case fails with `PROCESSING_ERROR`. Open a new terminal, or first run
> `unset EXTRACTION_MODEL EXTRACTION_FALLBACK_MODELS OPENAI_API_KEY OPENAI_BASE_URL`.
> (`run.sh` handles this for you.)

**Terminal 2, the dashboard:**

```bash
cd frontend && npm run dev
```

<details>
<summary>Starting the backend without <code>start.sh</code></summary>

These commands do the same thing as `start.sh`:

```bash
unset OPENAI_API_KEY OPENAI_BASE_URL
export BACKEND_API_KEY=dev-app-key
export GEMINI_API_KEY="$(< ~/.config/zamp/gemini.key)"
export GROQ_API_KEY="$(< ~/.config/zamp/groq.key)"
export EXTRACTION_MODEL='gemini:gemini-3.5-flash'
export EXTRACTION_FALLBACK_MODELS='groq:openai/gpt-oss-120b,gemini:gemini-3-flash-preview,gemini:gemini-3.5-flash-lite,groq:qwen/qwen3.8-27b'
export EXTRACTION_PROVIDER_RETRIES=3
export EXTRACTION_RETRY_BACKOFF_SECONDS=5
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Keep `--workers 1`: a single worker process owns the processing database.

</details>

| URL | What |
| --- | --- |
| http://localhost:5173 | **The dashboard** |
| http://127.0.0.1:8000/docs | Interactive API documentation (Swagger) |
| http://127.0.0.1:8000/health | Backend health JSON |
| http://127.0.0.1:8000/ | Legacy read-only inbox page. Works only when `BACKEND_API_KEY` is unset; otherwise it shows `UNAUTHORIZED`, because a browser page can't send the key. Use the dashboard instead |

## Data and resets

| What | Where | Cleared by a reset? |
| --- | --- | --- |
| Processed cases, uploaded PDFs, audit history, PO reservations | `backend/runtime/processing.sqlite3` | Yes |
| Approved-invoice Excel copy | `backend/runtime/exports/` | Rewritten (empty) |
| Trusted vendor, PO, FX and policy data | `backend/procurement.json` | No |
| Sample emails, PDFs, inbox and labels | `test_cases/` | No, never modified |

A reset happens:
- on every backend start, unless `RESET_ON_START=false`;
- when you click **Refresh & start fresh** on the dashboard home page, which
  needs no restart and also reloads every dashboard query, including
  Reference data. An extraction that is already running finishes before the
  reset clears its case.

`backend/runtime/` is ignored by Git.

The dashboard shows both unique case counts and distinct inbox email outcomes.
Identical attachments share one case but count as separate duplicate email
submissions.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `run.sh` says *Port 8000 (or 5173) is already in use* | An earlier backend or dashboard is still running. Stop it (Ctrl+C in its terminal) and run again |
| Every case shows `PROCESSING_ERROR` right after a start | Usually example values exported in the shell, such as `EXTRACTION_MODEL=your-model-id` or `OPENAI_API_KEY=sk-...`, override the defaults. Use `./run.sh`, which ignores them, or open a new terminal before `./backend/start.sh`. Then click **Retry processing**. For other causes, look in the backend output for `Processing failed for case …` |
| Startup prints `GEMINI_API_KEY: NOT SET` (or `GROQ_…`) | That key file in `~/.config/zamp/` is missing or empty. Save it as shown in [Save your API keys](#2-save-your-api-keys-once) |
| Every case shows `EXTRACTION_NOT_CONFIGURED` | No model in the chain has a key. Save at least one key, restart, then click **Retry processing** |
| Backend output shows `Transient provider error` or `moving to the next model` | A provider quota or rate limit was hit, and the fallback chain is handling it. If every model is exhausted, the case goes to review; retry it later |
| Scanned invoices show `OCR_UNAVAILABLE` | Install `tesseract-ocr`, restart, then retry |
| Sidebar shows *Backend unreachable* | The backend isn't running on port 8000, or `BACKEND_URL` points elsewhere |
| Errors mention `401` / `X-API-Key` | The dashboard's `BACKEND_API_KEY` differs from the backend's. Set the same value and restart the dashboard |
| Review buttons stay disabled | Enter your name (at least 2 characters) in the form or in **Settings** |
| Cases stay *Queued* | The worker isn't running. Check `WORKER_ENABLED`, and that only one backend process uses the database |
| Backend refuses to start a second worker | Only one process may own a processing database. Stop the other one |
| **Approve manually** or the Excel download fails with `404` | The running backend is older than the dashboard. Restart it (`RESET_ON_START=false ./run.sh` keeps cases) |

## Tests

Backend tests and sample-input checks:

```bash
RESET_ON_START=false ./zamp_venv/bin/python -m unittest discover -s test_cases -v
./zamp_venv/bin/python -m unittest backend.test_reset backend.test_audit_fixes -v
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

**Live end-to-end audit.** `backend/audit_inbox.py` runs the real PDF, OCR and
model pipeline over all 50 inbox emails in a separate database, then compares
the outcomes with the expected labels. Labels are read only after processing.
It uses provider quota, so export the keys and model chain first (as
`backend/start.sh` does), then run:

```bash
./zamp_venv/bin/python -m backend.audit_inbox --output backend/runtime/audit --workers 1
```

Extractions are cached per email in the output folder, so a rerun only calls
the model for emails that are missing or failed. The run on 2026-11-08 with
the Gemini/Groq chain matched all 50 labels (40 approved, 8 review,
2 duplicate). Model output varies between runs and providers, so treat this as
a spot check, not a guarantee.

**Sample data.** Generate sample inputs with
`./zamp_venv/bin/python -m test_cases.generate_inbox`. The generator refuses to
overwrite an existing inbox database. See the
[fixture guide](test_cases/test_inputs/README.md) and
[edge cases](test_cases/EDGE_CASES.md) for details. Expected outcomes are
reference labels only. The processing backend never reads them; only the
separate audit tool compares against them.

## Production build

```bash
cd frontend && npm run build              # static files in frontend/dist
```

Serve `frontend/dist` behind a reverse proxy. The proxy must fall back to
`index.html` for unknown routes, forward `/api`, `/emails`, `/vendors`,
`/purchase-orders` and `/health` to the backend, and add `X-API-Key`
server-side.

More detail:
- [Backend guide](backend/README.md): the API for integrations, processing
  controls, Docker, persistence and operational limits.
- [Frontend guide](frontend/README.md): the dashboard's architecture and how
  to add screens.

## Project layout

```text
run.sh                   One-command local start: dependencies, backend, dashboard
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
  start.sh               Backend startup: loads keys, sets the Gemini/Groq model chain
  Dockerfile             Container build with Tesseract OCR
  .env.example           Environment configuration example
  README.md              API integration and operational guide
  openapi.json           Exported frontend API contract
  export_openapi.py      API contract export utility
  test_reset.py          Reset regression tests
  test_audit_fixes.py    Regression tests for fixes found by the live audit
  runtime/               Local processing data and the Excel export (ignored by Git)
frontend/                React + TypeScript review dashboard (see frontend/README.md)
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

`zamp_venv/` is the local Python environment, not application source. It is
created by `run.sh` and ignored by Git.
