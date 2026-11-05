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
  Dockerfile             Container build with Tesseract OCR
  .env.example           Environment configuration example
  README.md              Setup, API integration and operational guide
  openapi.json           Exported frontend API contract
  export_openapi.py      API contract export utility
  runtime/               Local processing data (ignored by Git)
frontend/                Existing inbox page; no new frontend implementation
  inbox.html
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

Install dependencies and configure credentials using
[backend setup and API integration](backend/README.md) and
[the environment example](backend/.env.example):

```bash
./zamp_venv/bin/python -m pip install -r backend/requirements.txt
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The inbox demo is at `/`, interactive API documentation at `/docs`, and
processing endpoints under `/api/v1`. LangChain extracts structured facts;
deterministic Python validates, matches and decides. Human corrections re-enter
at validation. Approval reserves local PO value and never executes payments.

Run all tests and verify sample inputs:

```bash
./zamp_venv/bin/python -m unittest discover -s test_cases -v
./zamp_venv/bin/python -m test_cases.validate_inbox
./zamp_venv/bin/python -m backend.export_openapi
```

Generate sample inputs with `./zamp_venv/bin/python -m test_cases.generate_inbox`.
The generator refuses to overwrite an existing inbox database. See the
[fixture guide](test_cases/test_inputs/README.md) and
[edge cases](test_cases/EDGE_CASES.md) for dataset details.

All fixture identities and documents are fictional. No emails are sent.
Expected fixture outcomes are reference labels, not measured live extraction
performance; expected outcomes are never read by the processing backend.
