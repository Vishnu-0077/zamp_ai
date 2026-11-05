# How to use the test inputs

This dataset contains **50 fictional vendor emails with PDF invoices**:
**40 routine invoices and exactly 10 edge cases**. No real emails are sent and
no real payments should be made.

## View the emails for a demo

From the project directory (`/home/hpvishnu/zamp_ai`), start the app:

```bash
./zamp_venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open **http://localhost:8000** in your browser. If the server is already running,
just open the link.

Search for a sender or invoice number, select an email to read its message, and
preview the attached invoice or click **Open PDF**. **Download email** saves the
original message, including its attachment.

The interface displays test inputs. It does not run invoice extraction,
validation, duplicate detection, or payment approval.

## What is in this folder?

| Path | Contents |
| --- | --- |
| `emails/` | 50 `.eml` files containing email headers, message bodies and attached PDFs |
| `attachments/` | Separate copies of the same 50 invoice PDFs |
| `inbox.sqlite3` | Inbox records, approved vendor master and purchase orders used by the app |
| `ground_truth/expected.json` | Expected outcome, reason, missing fields and duplicate relationships for each email |
| `ground_truth/procurement.json` | Vendor and purchase-order reference data for validation |

Each filename starts with the email ID. For example, files starting with `41_`
belong to email 41. A PDF embedded in an `.eml` and its copy in `attachments/`
are the same input; do not ingest both as separate incoming invoices.

## Where are the edge cases?

**Emails 1–40** are routine, valid invoices from five approved suppliers.
Several invoices come from the same company, with distinct invoice numbers and
purchase orders. A repeated supplier alone does not make an invoice a duplicate.

**Emails 41–50** are the 10 edge cases:

| Email ID / filename prefix | Scenario | Expected outcome |
| --- | --- | --- |
| `41_` | Follow-up containing the exact PDF from email 1 | Duplicate |
| `42_` | Reissued PDF with the same vendor and invoice number as email 2 | Duplicate |
| `43_` | Invoice number from email 3 with punctuation removed; other details match | Human review for a possible duplicate |
| `44_` | Unregistered vendor claims a PO belonging to another supplier | Human review |
| `45_` | Northstar display name with a lookalike sender domain | Human review |
| `46_` | Invoice number missing from both email and PDF | Human review |
| `47_` | Final amount due missing from both email and PDF | Human review |
| `48_` | Currency unspecified in both email and PDF | Human review |
| `49_` | Optional contact name, address and phone missing; critical fields complete | Approve |
| `50_` | Vague email; invoice lacks only an optional due date; vendor master supplies Net 30 terms | Approve |

An edge case is not necessarily invalid. Emails 49 and 50 demonstrate that
missing optional information should not block an otherwise valid invoice.

Expected totals across all 50 emails: **42 approvals, 2 duplicates and 6 human
reviews**. These are fixture labels, not results produced by the app.

## Use with an invoice-processing pipeline

1. Load approved vendors and purchase orders from
   `ground_truth/procurement.json` as business reference data.
2. Process the `.eml` files in ascending ID order. Extract each message and its
   attached PDF, then run your extraction and validation pipeline.
3. Retain earlier invoice history so emails 41–43 can be compared with emails
   1–3. When repeating the demo, reset your pipeline's imported invoices and
   processing history so previous runs do not make every invoice a duplicate.
4. Compare your results with `ground_truth/expected.json` after processing.
   Each record includes `id`, `is_edge_case`, `expected`, `reason`,
   `missing_fields`, `fields` and `duplicate_of`.

Keep `expected.json`, scenario labels and descriptive filenames out of model
prompts and extraction inputs. Use the actual email contents and attachment
filenames from the message. Expected outcomes are evaluation answers, not
information the pipeline should use to make decisions.

All intended valid invoices use USD. PO amounts and received amounts are gross
values, including tax. Each unique legitimate invoice has its own fully received
PO, allowing normal invoices to remain valid when processed sequentially.
The unclear-currency case intentionally omits currency from the incoming document.

## API access

With the server running, interactive API documentation is available at
http://localhost:8000/docs.

| Endpoint | Purpose |
| --- | --- |
| `GET /emails` | List inbox records |
| `GET /emails/{id}` | Get one inbox record |
| `GET /emails/{id}/preview` | Read message headers and plain-text body |
| `GET /emails/{id}/attachment` | Open the attached PDF |
| `GET /emails/{id}/raw` | Download the original `.eml` |
| `GET /vendors` | Read vendor reference data |
| `GET /purchase-orders` | Read purchase-order reference data |

For a short demo, show a routine invoice first, another valid invoice from the
same supplier, duplicate emails 41–43, fake-vendor emails 44–45, missing critical
details in 46–48, and valid optional-detail cases 49–50.
