# Invoice processing backend

The existing inbox stays at `/`. Processing is under `/api/v1`; Swagger is at
`/docs`. No frontend changes are required to use the API. The backend never reads
`expected.json`, never uses fixture scenario labels for decisions, and never
executes payments. `approved` means all configured processing rules passed, or
a reviewer approved the case manually after acknowledging every open finding
(`decision.manual_override`), and PO/receipt value has been reserved in the
local ledger.

## Run locally

Requires Python 3.11+ on Linux/WSL (worker locking uses `fcntl`). Run commands
from the repository root.

```bash
python3 -m venv zamp_venv                 # skip if it already exists
./zamp_venv/bin/python -m pip install -r backend/requirements.txt
sudo apt-get install -y tesseract-ocr     # OCR for scanned PDFs (Ubuntu/Debian)
```

Save a Gemini and/or Groq key in `~/.config/zamp/gemini.key` and
`~/.config/zamp/groq.key` (see [Save your API keys](../README.md#2-save-your-api-keys-once) in the
root guide), then start the backend on its own, or use `./run.sh` from the
repository root to start the backend and dashboard together:

```bash
./backend/start.sh                        # RESET_ON_START=false ./backend/start.sh keeps cases
```

`start.sh` loads the key files from `${ZAMP_KEY_DIR:-$HOME/.config/zamp}`,
sets `BACKEND_API_KEY=dev-app-key`, uses the Gemini/Groq model chain
(`gemini:gemini-3.5-flash`, then `groq:openai/gpt-oss-120b`,
`gemini:gemini-3-flash-preview`, `gemini:gemini-3.5-flash-lite`,
`groq:qwen/qwen3.8-27b`) with 3 retries per model, clears `OPENAI_API_KEY` and
`OPENAI_BASE_URL`, and resets processing state. It prints which keys it found,
never their values. **Variables already exported in your shell take priority**,
so start from a clean terminal: an exported placeholder such as
`EXTRACTION_MODEL=your-model-id` makes every case fail with `PROCESSING_ERROR`.

The app reads exported variables only and never loads `.env` files;
`backend/.env.example` lists them. Model IDs with a `gemini:` or `groq:` prefix
use that provider with `GEMINI_API_KEY` or `GROQ_API_KEY`; entries whose key is
missing are skipped. An unprefixed model ID goes to OpenAI (or
`OPENAI_BASE_URL`) with `OPENAI_API_KEY`; this setup does not use it. Models
must support native JSON-schema structured output and temperature 0. No model
is silently selected. Provider quotas and billing depend on your account.

No usable model key means processing goes to review with
`EXTRACTION_NOT_CONFIGURED`. Missing Tesseract produces `OCR_UNAVAILABLE` for
scans or mixed raster pages. See the [root guide](../README.md) for the
dashboard.

`backend/procurement.json` contains the trusted synthetic vendor/PO/FX master
and fixed demo evaluation date. Reset clears processing results while preserving
this configuration. `aliases` lists explicitly trusted printed vendor names;
matching remains exact and ambiguous identities require review. Never populate
trusted reference data from model output or expected outcome labels.

## Container

The Dockerfile includes Tesseract and runs as a non-root user:

```bash
docker build -f backend/Dockerfile -t invoice-backend .
docker run --rm -p 8000:8000 --env-file .env -v invoice-data:/app/backend/runtime invoice-backend
```

Copy `backend/.env.example` to `.env` and fill the values before using `--env-file`.
Build/run have not been verified on hosts without Docker. Keep the runtime
volume: it holds source PDFs, queue, results, audit history and PO reservations.

## Frontend integration

Use `/openapi.json` (also exported as `backend/openapi.json`) for generated clients.
Case amounts are decimal strings, never binary floats. Dates are ISO strings.
Nullable extraction values always remain explicit `null` values.

Requests use `X-API-Key` when `BACKEND_API_KEY` is configured. The key must be
provided through your authenticated server or a controlled local client (the
dashboard's proxy), not embedded in a public frontend bundle. Review actions
(corrections, manual approval, retry) need no extra credential: anyone who can
reach the API through the dashboard may perform them. Each request carries a
self-reported `reviewer` name, which is recorded as the audit actor
(`reviewer:<name>`) and in the Excel export. It is not authentication; put the
dashboard behind your company sign-in if reviewers must be verified. CORS allows only
`CORS_ORIGINS`. Documentation/schema/health are public; business routes and the
legacy inbox routes use application-key authentication when enabled.

1. Queue an existing inbox attachment:

   ```http
   POST /api/v1/ingest/email
   Content-Type: application/json
   X-API-Key: your-application-token

   {"email_id": 1}
   ```

   Response 202: `{"id":"uuid","status":"queued","duplicate_submission":false}`.
   An identical PDF returns its existing case ID and records a new submission
   event, including sender/email metadata. No extra reservation is made.

2. Poll `GET /api/v1/cases/{id}` until status is `review`, `approved`, or
   `duplicate`. Intermediate statuses are `queued` and `processing`.
   Lists use `GET /api/v1/cases?status=review&limit=25&offset=0`; the response
   has `items`, `total`, `limit`, `offset`. Lists return summaries; detail adds
   page text/OCR confidence, extraction, individual checks and policy snapshot.

3. Build the review screen from `extraction`, `checks`, `findings`, `decision`,
   and `GET /api/v1/cases/{id}/document` for the source PDF. Findings expose
   stable uppercase `code`, human-readable `message`, `stage`, and nullable
   `field`. Each extracted scalar uses `{value,confidence,evidence,page}`;
   line-item fields use the same structure. The entire input shape is exposed by
   `GET /api/v1/schema/extraction`.

4. Submit `POST /api/v1/cases/{id}/corrections` with:

   ```json
   {
     "expected_version": 3,
     "reviewer": "Priya Sharma",
     "note": "Visually checked every submitted field against the source PDF",
     "extraction": "replace this string with the complete InvoiceExtraction object"
   }
   ```

   `extraction` must be the complete object returned in case detail, with edits;
   the string above is only a placeholder, not a valid request. Include the
   application key header. Submission explicitly attests all submitted values,
   including nulls and line items. The server records before/after values and
   reviewer identity, and reruns validation, vendor/bank checks, duplicates,
   matching, math, dates, FX, PO balance and the rule engine. Human attestation
   replaces evidence/model/OCR confidence checks; it cannot waive missing
   critical values or business failures. A correction may remain in `review`.
   It never calls OCR or the model. A stale version or terminal case gives 409;
   reload detail before editing again.

   To approve a held case after checking it by eye, `POST /api/v1/cases/{id}/approve`
   with `{"expected_version": n, "reviewer": "...", "note": "...", "acknowledged_codes": [...]}`.
   `acknowledged_codes` must include every open reason code. The values
   are not changed; the decision records `manual_override: true` and the overridden
   codes, the PO value is reserved when a PO is known, and a `manual_approval` audit
   event stores the note and reviewer. Refused (409) while nothing usable was
   extracted (processing errors, bundled documents), when an open code is not
   acknowledged, or when the version is stale.

5. Read audit events with `GET /api/v1/cases/{id}/audit?after=0&limit=100`;
   pass the last event ID as `after` for the next page. `GET /api/v1/stats`
   returns counts by status. `GET /api/v1/references` returns trusted reference
   data including PO, vendor and policy information.

6. Download the approved-invoice register with
   `GET /api/v1/exports/approved-invoices.xlsx`. It is generated from current
   data on every request. Sheets: *Summary* (counts, manual approvals, totals by
   currency and by vendor), *Approved invoices* (one row per invoice: approval
   time in UTC, Automatic/Manual, approver, vendor, invoice and PO numbers,
   dates, subtotal, tax, total, PO currency and amount charged to the PO, the
   bank account on the vendor record **and** the one on the invoice, payment
   terms, items, reviewer note, overridden issues, source file, inbox email and
   case ID; manual approvals highlighted) and *Line items*. The service also
   rewrites a copy after every approval, on startup and on reset, at
   `APPROVED_EXPORT_PATH` (default `exports/approved_invoices.xlsx` beside the
   processing database). The file is replaced atomically and is world-readable,
   so it can sit in a shared folder. A failed export is logged and never undoes
   an approval.

Other ingestion routes:

- `POST /api/v1/ingest/pdf`: raw PDF body, optional `X-Filename` and `X-Sender`.
  Limit 20 MiB. No multipart encoding is needed.
- `POST /api/v1/ingest/eml`: raw RFC 5322 email body. Up to 20 PDF MIME parts;
  returns `{"items":[...ingest results...]}`. Maximum email size is 40 MiB.
  Sender headers are provenance only, never vendor approval evidence.

Standard FastAPI validation errors return 422. Missing cases return 404,
invalid application credentials 401, conflicts 409 and oversized HTTP uploads
413. Service errors use
`{"error":{"code":"...","message":"..."}}`; framework HTTP/validation errors
use FastAPI's `detail` format. PDF download remains behind application auth.

## Processing and controls

- Source ingestion computes SHA-256 before extraction. Jobs and source bytes
  are committed before returning 202; identical source bytes share one case.
- Every page gets digital text parsing or Tesseract OCR. Mixed image/text pages
  are conservatively OCRed too, to avoid ignoring scanned content. Full-page
  scans are OCRed at their native resolution (resampling turned an `11` into
  `14`). Tesseract reads forms column by column, so its words are rebuilt into
  visual rows by vertical overlap; a label and its value then stay on one line
  and quoted evidence is contiguous. Digital text keeps its span order, because
  geometric sorting merged distant columns (`INVOICEHARBOR`). PDF size,
  page count, text context and OCR subprocess time are bounded. Encrypted,
  malformed, blank or unsupported documents go to review.
- `LangChainExtractor` calls `ChatOpenAI.with_structured_output` with a Pydantic
  batch schema, native `json_schema`, strict output and temperature 0. SDK-level
  retries are off. Parsing/schema failures retry exactly once. By default a
  provider error becomes a review finding after one attempt. Optional transient-error
  handling (429, 5xx, timeouts only) is configured explicitly:
  `EXTRACTION_PROVIDER_RETRIES` retries per model with exponential backoff
  from `EXTRACTION_RETRY_BACKOFF_SECONDS`, honouring `Retry-After` or Google
  `retryDelay` hints up to 60 s. Longer hints, such as an exhausted daily quota,
  move straight to the next model in `EXTRACTION_FALLBACK_MODELS`. These also
  move immediately to the next model: provider HTTP 413 (request too large),
  a reply cut off at the output-token limit (`max_tokens` is 8192, because
  reasoning models such as Groq gpt-oss spend output tokens thinking), and a
  provider rejecting the output against the schema (Groq HTTP 400). Our own
  schema-validation failures and other errors are not retried across models. Each case
  records the model that produced its extraction. Source instructions are
  treated as untrusted data; the model has no business tools or decision
  authority.
- Core required fields include due date as well as invoice identity, vendor, currency, PO, amounts, account details and line items.
- Model extraction retains document type, original reference, vendor, invoice
  and due dates, currency, PO, line items, subtotal, tax, total, account details,
  and optional GST components. Multipage invoices remain a single case.
- Evidence must exist on the cited page; whitespace differences are ignored.
  Unsupported quotations receive one bounded source-only extraction repair pass. Numeric/string values are
  checked against evidence; dates require an unambiguous recognized display
  form. Other date formats are conservatively reviewed. Critical fields require
  high model confidence; other present fields reject low confidence. OCR pages
  require page confidence >=85. These are gates, not calibrated probabilities.
  Math failures also mark affected aggregate fields low confidence.
- Vendor matching uses exact normalized names or explicitly configured aliases only. Approval and account details
  must match trusted master data. Duplicate identity uses vendor and the case-insensitive printed
  invoice number (punctuation retained); fuzzy checks combine vendor, amount, currency, date window,
  invoice-number similarity or PO. Unresolved identity collisions stay in review.
- Explicit PO references run first. Missing-PO candidates are advisory and cannot
  waive the required PO field. Candidates use vendor/currency/amount and the configured PO date window (365 days by default). Ambiguity
  requires review. Optional LLM PO ranking, multimodal fallback and reviewer
  prose assistance are not enabled: the core model only extracts facts.
- Decimal math checks line quantity × price, line sum, subtotal + tax, finite
  and nonnegative values, and nonzero total. Existing adjustment-document,
  date, bank, GST and dated approved FX rules remain in use. Bank changes never
  update the vendor master. Unsupported adjustments require separate workflows.
- PO and received balances account for master `previously_invoiced` plus local
  reservations. Hard balance caps use configured absolute `amount_tolerance`;
  PO `tolerance_percent` never permits spending beyond available/received value.
  Cross-currency reservations use the unique approved exact-date FX rate.
- Duplicate checks, rule evaluation and reservations commit in a single
  `BEGIN IMMEDIATE` transaction. Concurrent invoices cannot independently
  reserve the same remaining balance. Explanations are deterministic templates.
- Bundled invoices/credit notes are identified by the extraction batch schema
  and held with `MULTIPLE_DOCUMENTS`. Split the original PDF and ingest each
  document independently; a reviewer cannot attest a bundle into one invoice.
- Dependency retry is distinct from correction. After repairing OCR/provider
  configuration, `POST /api/v1/cases/{id}/retry` accepts `expected_version`, a
  `reviewer` name and a `note`. Only processing dependency failures qualify.
  Business findings cannot restart extraction through this route.

## Persistence and operational scope

SQLite is the initial persistence layer, with WAL and a durable queue. Use one
worker process per database; a Linux file lock rejects a second worker owner.
API-only processes may use `WORKER_ENABLED=false`. Restarted in-flight jobs go
to review with an explicit retry, rather than silently repeating external calls.
`RESET_ON_START=true` clears jobs, submissions, audit history and local PO
reservations after the worker acquires the database lock. The default is
`true` for both direct startup and the helper. Set `RESET_ON_START=false`
explicitly to retain processing history.
Source fixtures and trusted procurement configuration are retained. Use reset only for local
development where losing processing history is intended.

Do not use multiple independent databases against the same real PO ledger.
This implementation reserves locally; a real ERP deployment must reconcile and
atomically reserve against its authoritative procurement ledger.

Trusted master updates are done outside the invoice workflow. The API exposes
no vendor/PO mutation or reservation reversal, no payment execution, and no
editing of approved or duplicate cases. A manual approval accepts a changed
bank account for that invoice only; it never updates the vendor master. Audit records are append-only through this API,
not tamper-proof against filesystem/database administrators. Protect and back
up the runtime volume and keys before exposing the service externally.

`POST /api/v1/reset` requires the application key when configured. It waits for active processing, then atomically removes cases, source PDF
bytes, extracted results, submissions, audit events and reservations. It preserves the trusted
reference configuration needed for subsequent validation, and rewrites the
Excel register (now empty). No files under `test_cases/` are changed. The home
page's **Refresh & start fresh** button also clears the browser query cache.

## Verification

```bash
RESET_ON_START=false ./zamp_venv/bin/python -m unittest discover -s test_cases -v
./zamp_venv/bin/python -m unittest backend.test_reset backend.test_audit_fixes -v
./zamp_venv/bin/python -m unittest test_cases.test_invoice_checks -v
./zamp_venv/bin/python -m test_cases.validate_inbox
./zamp_venv/bin/python -m backend.export_openapi
```

Backend tests use real temporary SQLite databases and generated PDFs with a
mocked extractor. LangChain call configuration/schema retries are tested without
paid calls. OCR and live model extraction need system Tesseract and provider
credentials respectively.

`python -m backend.audit_inbox --output <dir> [--workers N] [--repair-cached]`
runs the real pipeline over the 50 inbox emails in its own database (it refuses
the application database and `test_cases/`), caches each extraction as
`<dir>/<email>.json`, and writes `report.json` with counts and mismatches.
Labels are read only after processing, for the comparison. A run on
2026-11-08 with the Gemini/Groq chain matched all 50 (40 approved, 8 review,
2 duplicate). Model output varies, so this is a spot check, not a measured
accuracy rate.

Implementation references: [LangChain structured-output API](https://reference.langchain.com/python/langchain-openai/chat_models/base/ChatOpenAI/with_structured_output)
and [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
