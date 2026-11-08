# Invoice processing backend

The existing inbox stays at `/`. Processing is under `/api/v1`; Swagger is at
`/docs`. No frontend changes are required to use the API. The backend never reads
`expected.json`, never uses fixture scenario labels for decisions, and never
executes payments. `approved` means all configured processing rules passed and
PO/receipt value has been reserved in the local ledger.

## Run locally

Requires Python 3.11+ on Linux/WSL (worker locking uses `fcntl`). Run commands
from the repository root. Create the environment first if needed:

```bash
python3 -m venv zamp_venv
```

```bash
./zamp_venv/bin/python -m pip install -r backend/requirements.txt
# Install the system OCR dependency (Ubuntu/Debian):
sudo apt-get install -y tesseract-ocr
# Set provider credentials and an available structured-output model:
export OPENAI_API_KEY='your-key'
export EXTRACTION_MODEL='your-model-id'
export BACKEND_API_KEY='your-application-token'
export REVIEWER_API_KEY='your-reviewer-token'
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

`backend/.env.example` lists configuration; environment variables must be exported (the
app does not implicitly load `.env`). `OPENAI_BASE_URL` supports compatible
providers with native JSON-schema structured output and temperature 0. Provider
credentials are handled by `langchain-openai`. No model is silently selected.
Model entries can also use `gemini:<model-id>` or `groq:<model-id>` with
`GEMINI_API_KEY` or `GROQ_API_KEY`. `EXTRACTION_FALLBACK_MODELS` accepts a
comma-separated mix of providers; missing provider keys cause those entries to
be skipped. Choose model IDs available to your account. Provider billing and
quotas depend on your account.

For local setup, `./backend/start.sh` loads keys from
`${ZAMP_KEY_DIR:-$HOME/.config/zamp}/gemini.key` and `groq.key`, preferring
exported keys. It supplies development application/reviewer keys, clears
`OPENAI_API_KEY` and `OPENAI_BASE_URL`, and defaults to resetting processing
state. Use `RESET_ON_START=false ./backend/start.sh` to retain cases; override
model variables as needed. See the [root guide](../README.md) for the dashboard.

No credentials means processing goes to review with `EXTRACTION_NOT_CONFIGURED`.
Missing Tesseract produces `OCR_UNAVAILABLE` for scans or mixed raster pages.

`backend/procurement.json` starts with empty vendor, purchase-order and FX lists
and an empty validation policy. Reset and default startup empty this file (or
`PROCUREMENT_PATH`) too. Populate trusted references after startup to evaluate
invoices against them, or set `RESET_ON_START=false` to keep your configured data
across restarts. Never populate trusted data from invoice text. With no vendor/PO
records, invoices require review. An unset policy date uses the current UTC date.

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

Requests use `X-API-Key` when `BACKEND_API_KEY` is configured. Correction/retry
requests additionally require `X-Reviewer-Key`, configured by `REVIEWER_API_KEY`.
Keys must be provided through your authenticated server or a controlled local
client, not embedded in a public frontend bundle. The shared reviewer token is
an initial service credential, with a hashed credential identifier in the audit;
an identity-aware gateway is needed for per-user identities. CORS allows only
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
     "note": "Visually checked every submitted field against the source PDF",
     "extraction": "replace this string with the complete InvoiceExtraction object"
   }
   ```

   `extraction` must be the complete object returned in case detail, with edits;
   the string above is only a placeholder, not a valid request. Include both
   authentication headers. Submission explicitly attests all submitted values,
   including nulls and line items. The server records before/after values and
   reviewer identity, and reruns validation, vendor/bank checks, duplicates,
   matching, math, dates, FX, PO balance and the rule engine. Human attestation
   replaces evidence/model/OCR confidence checks; it cannot waive missing
   critical values or business failures. A correction may remain in `review`.
   It never calls OCR or the model. A stale version or terminal case gives 409;
   reload detail before editing again. There is no force-approve endpoint.

5. Read audit events with `GET /api/v1/cases/{id}/audit?after=0&limit=100`;
   pass the last event ID as `after` for the next page. `GET /api/v1/stats`
   returns counts by status. `GET /api/v1/references` returns trusted reference
   data including PO, vendor and policy information.

Other ingestion routes:

- `POST /api/v1/ingest/pdf`: raw PDF body, optional `X-Filename` and `X-Sender`.
  Limit 20 MiB. No multipart encoding is needed.
- `POST /api/v1/ingest/eml`: raw RFC 5322 email body. Up to 20 PDF MIME parts;
  returns `{"items":[...ingest results...]}`. Maximum email size is 40 MiB.
  Sender headers are provenance only, never vendor approval evidence.

Standard FastAPI validation errors return 422. Missing cases return 404,
invalid application credentials 401, reviewer credentials 403, conflicts 409,
and oversized HTTP uploads 413. Service errors use
`{"error":{"code":"...","message":"..."}}`; framework HTTP/validation errors
use FastAPI's `detail` format. PDF download remains behind application auth.

## Processing and controls

- Source ingestion computes SHA-256 before extraction. Jobs and source bytes
  are committed before returning 202; identical source bytes share one case.
- Every page gets digital text parsing or Tesseract OCR. Mixed image/text pages
  are conservatively OCRed too, to avoid ignoring scanned content. PDF size,
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
  move straight to the next model in `EXTRACTION_FALLBACK_MODELS`. Provider HTTP
  413 responses also move immediately to the next model. Schema
  failures and other non-transient errors are never retried across models. Each case
  records the model that produced its extraction. Source instructions are
  treated as untrusted data; the model has no business tools or decision
  authority.
- Core required fields include due date as well as invoice identity, vendor, currency, PO, amounts, account details and line items.
- Model extraction retains document type, original reference, vendor, invoice
  and due dates, currency, PO, line items, subtotal, tax, total, account details,
  and optional GST components. Multipage invoices remain a single case.
- Verbatim evidence must exist on the cited page. Numeric/string values are
  checked against evidence; dates require an unambiguous recognized display
  form. Other date formats are conservatively reviewed. Critical fields require
  high model confidence; other present fields reject low confidence. OCR pages
  require page confidence >=85. These are gates, not calibrated probabilities.
  Math failures also mark affected aggregate fields low confidence.
- Vendor matching uses exact normalized names only. Approval and account details
  must match trusted master data. Duplicate identity uses vendor and normalized
  invoice number; fuzzy checks combine vendor, amount, currency, date window,
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
  configuration, `POST /api/v1/cases/{id}/retry` accepts `expected_version` and
  a `note`, with reviewer auth. Only processing dependency failures qualify.
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
Source fixtures are retained; procurement reference records are cleared. Use reset only for local
development where losing processing history is intended.

Do not use multiple independent databases against the same real PO ledger.
This implementation reserves locally; a real ERP deployment must reconcile and
atomically reserve against its authoritative procurement ledger.

Trusted master updates are done outside the invoice workflow. The API exposes
no vendor/PO mutation or reservation reversal, no payment execution, and no
manual terminal-case editing. Audit records are append-only through this API,
not tamper-proof against filesystem/database administrators. Protect and back
up the runtime volume and keys before exposing the service externally.

`POST /api/v1/reset` requires the application key when configured; no reviewer
key is needed. It waits for active processing, then atomically removes cases, source PDF
bytes, extracted results, submissions, audit events and reservations. It also atomically replaces
the current reference file with empty vendors, POs, FX rates and policy. No files under `test_cases/` are changed. The home
page's **Refresh & start fresh** button also clears the browser query cache.

## Verification

```bash
RESET_ON_START=false ./zamp_venv/bin/python -m unittest discover -s test_cases -v
./zamp_venv/bin/python -m unittest backend.test_reset.ResetTests -v
./zamp_venv/bin/python -m unittest test_cases.test_invoice_checks -v
./zamp_venv/bin/python -m test_cases.validate_inbox
./zamp_venv/bin/python -m backend.export_openapi
```

Backend tests use real temporary SQLite databases and generated PDFs with a
mocked extractor. LangChain call configuration/schema retries are tested without
paid calls. OCR and live model extraction need system Tesseract and provider
credentials respectively; the synthetic 40/2/8 expected totals are not claimed
as measured extraction performance.

Implementation references: [LangChain structured-output API](https://reference.langchain.com/python/langchain-openai/chat_models/base/ChatOpenAI/with_structured_output)
and [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
