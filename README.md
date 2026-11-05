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

See `EDGE_CASES.md` for the 10 exceptions. There are 42 expected approvals,
2 duplicates and 6 human-review outcomes. Two edge cases are intentionally valid:
missing optional contact information and a vague message with a complete invoice
except an optional due date. The vendor master supplies Net 30 terms.

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
