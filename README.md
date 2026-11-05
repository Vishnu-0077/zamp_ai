# Synthetic vendor inbox

All identities and documents are fictional. No emails are sent.

All test data lives in `test_inputs/`:

- `emails/`: 50 RFC 5322 email messages with PDF attachments.
- `attachments/`: the 50 corresponding invoice PDFs.
- `inbox.sqlite3`: inbox records, approved vendors and purchase orders.
- `ground_truth/`: expected outcomes and procurement reference data. Keep expected outcomes out of extraction inputs.

The dataset contains **40 routine invoices and exactly 10 edge cases**. Routine
invoices cover five recurring suppliers with different invoice numbers and POs;
multiple invoices from one company are valid. Each unique legitimate invoice has
its own fully received PO, so the ordinary invoices remain valid when processed
in order. Duplicate follow-ups refer to earlier messages.

Emails include normal sender names, subjects, timestamps, signatures, payment
terms and follow-up threads. Edge-case labels appear only in fixture metadata
and file paths, not in customer-facing subjects or bodies. PDFs carry a fictional
test-document footer.

See `EDGE_CASES.md` for the 10 combined exception scenarios. Expected email
outcomes are 40 approvals, 2 duplicates and 8 human reviews. Existing scenarios
are retained with added credit/debit notes, multipage and bundled documents,
FX/GST examples, date anomalies and bank changes. Ordinary emails 12, 13 and 18
provide valid FX/GST controls. The 50 PDFs contain 52 documents across 53 pages.

Start the read-only inbox API:

```bash
./zamp_venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open http://localhost:8000 for the demo inbox: search messages, read email bodies,
preview invoice PDFs, or download the original email. The inbox shows incoming
messages; it does not display ground-truth outcomes as processing results.
API documentation remains at http://localhost:8000/docs. This project supplies fixtures and an inbox API;
it does not implement extraction or automated payment decisions.

Generate a fresh dataset with `./zamp_venv/bin/python generate.py`. It refuses to
overwrite an existing database. `expand_inbox.py` is a compatibility entry point
for the same generator; it no longer appends extra exception cases.

Invoice designs now vary by supplier, from branded billing tables to traditional
contractor letters and plain warehouse exports. Repeat invoices retain the same
supplier stationery. Emails include formal, brief, informal, structured and
forwarded styles. The dataset includes **35 searchable PDFs and 15 image-only
PDFs requiring OCR**; this format mix is independent of the 10 business edge
cases. See `test_inputs/README.md` for scan IDs and online design references.

Run `./zamp_venv/bin/python validate_inputs.py` to verify fixture integrity and
PDF extraction routing. This check does not measure OCR accuracy.

`invoice_checks.py` checks structured extraction output for document classification,
bank changes, dates, GST arithmetic and FX references. It does not extract PDFs,
run OCR, detect duplicates or approve payments, and the demo does not run it
automatically. Run `./zamp_venv/bin/python -m unittest test_invoice_checks.py`
for rule-boundary tests. Full case instructions and policy assumptions are in
`test_inputs/README.md`.
