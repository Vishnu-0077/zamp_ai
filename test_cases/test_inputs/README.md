# How to use the test inputs

The dataset contains **50 fictional vendor emails, 50 PDF attachments, 40 routine
invoices and 10 edge-case email IDs**. Some attachments contain multiple pages or
multiple billing documents: there are **52 documents across 53 pages** in total.
No real messages are sent and no real payments should be made.

## View the demo

From `/home/hpvishnu/zamp_ai`, run:

```bash
./zamp_venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://localhost:8000**. If the server is already running, open the link
and refresh the page. Select an email, read its message, preview the attached PDF,
or use **Open PDF** and **Download email**. Use the PDF viewer's page controls to
read every page of emails 43 and 47. API docs are at http://localhost:8000/docs.

The demo browses inputs. It does not perform OCR, extract fields, execute the
field checks automatically, or make payment decisions.

## Folder contents

| Path | Contents |
| --- | --- |
| `emails/` | 50 `.eml` files with headers, message bodies and embedded PDF attachments |
| `attachments/` | Separate copies of those same 50 PDFs |
| `inbox.sqlite3` | Inbox records, approved vendor master and purchase orders |
| `ground_truth/expected.json` | Expected email/document outcomes, source fields, reasons, page ranges and case labels |
| `ground_truth/procurement.json` | Trusted vendor/PO data, approved synthetic FX rates and demo validation policy |

A filename's leading number is its email ID. An embedded PDF and its copy in
`attachments/` are the same input: do not ingest both as separate invoices.
A document's page range is 1-based and inclusive. One attachment is not always
one invoice, and one page is not always a complete invoice.

## Cases and expected outcomes

Emails **1–40** are ordinary valid invoices. Repeat suppliers with distinct
invoice numbers and orders are legitimate. Positive controls include:

| Email | What should work |
| --- | --- |
| 12 | USD invoice -> INR PO using approved rate 83.50 INR per USD, dated 2026-10-14 |
| 13 | INR invoice with correctly calculated IGST |
| 18 | INR invoice with correctly split CGST and SGST |

Emails **41–50** retain the previous scenarios with added features:

| Email | Scenario and added coverage | Expected outcome |
| --- | --- | --- |
| 41 | Follow-up with email 1's exact PDF | Duplicate |
| 42 | Reissued PDF with email 2's vendor and invoice number | Duplicate |
| 43 | Punctuation changed in email 3's invoice number; now two scanned pages with total only on the last page | Possible duplicate: OCR every page, then review |
| 44 | Unregistered vendor and another vendor's PO; negative total labelled INVOICE | Review identity and document classification; do not infer a credit note |
| 45 | Lookalike sender plus changed bank account | Review and independently verify bank details |
| 46 | Invoice number missing plus future issue date | Review |
| 47 | Three scanned pages: missing-total invoice, separate complete invoice, separate debit note | Split and OCR all three documents; review the incomplete invoice and adjustment |
| 48 | Missing currency, wrong CGST/SGST arithmetic, invoice dated before PO | Review |
| 49 | Optional contact details missing; now a credit note linked to an earlier invoice | Adjustment review; optional details alone are acceptable |
| 50 | Vague email, optional due date missing; now an old EUR invoice without an approved EUR-to-INR rate | Review age and FX; vague wording/optional due date alone are acceptable |

Expected **email-level** totals: **40 approvals, 2 duplicates, 8 human reviews**.
Ground-truth labels are test answers, not results produced by the demo app.
Email 47's second invoice has its own PO and is expected to pass these checks
independently. Its third document is a positive-value debit note referring to
invoice 002-2026-0002. Email 49 is a negative credit adjustment referring to
invoice 004-2026-0004. Neither note should enter a normal payable-invoice workflow.

## Searchable PDFs and OCR-only scans

**35 PDFs contain searchable text. 15 are image-only and require OCR:**

`03, 05, 08, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 43, 47`

Every page of an image-only PDF is rasterized at 180 DPI. There is no hidden text
layer. Scans vary between clean, mildly skewed and lightly noisy appearances.
Ordinary scans remain valid after successful extraction; scan format is separate
from the 10 business edge cases. OCR accuracy has not been measured.

For email **43**, combine both pages into one invoice and take the final total
from page 2. Do not create two invoices. For email **47**, create three document
records: invoice on page 1, a different invoice on page 2, debit note on page 3.
Do not combine their amounts or assume page 1 represents the whole attachment.

## Using a processing pipeline

1. Load vendor/PO data, `fx_rates` and `validation_policy` from
   `ground_truth/procurement.json` as business reference data.
2. Ingest emails in ascending ID order and extract their attachments. Classify
   document boundaries, read all pages, and use OCR wherever the text layer is absent.
3. Retain earlier invoice history so duplicate messages and note references can
   resolve to their original invoices. Reset imported invoice history between
   demo runs to avoid flagging the entire inbox as already seen.
4. Run your business checks using extracted fields and trusted reference data.
5. Compare the resulting decisions with `ground_truth/expected.json` afterward.

Keep `expected.json`, scenario names, descriptive fixture paths and expected
reasons out of extraction prompts. Use message contents and embedded attachment
filenames as extraction inputs. Expected labels are evaluation answers.

Ground-truth records include `is_edge_case`, `added_features`, `documents`,
`page_count`, `template_id`, `pdf_kind`, `requires_ocr` and `scan_variation`.
`documents` contains document-level source fields, page ranges and expectations.

## Field checks and policy

`backend/invoice_checks.py` provides `check_document(fields, vendor, po, fx_rates, policy)`
for structured extraction output. It returns findings with review codes and
reasons. It never reads expected outcomes and does not extract PDFs, perform OCR,
detect duplicates, fully match POs, or approve payments. No findings means only
that the implemented checks passed.

Covered checks include:

- Credit/debit-note classification and original-invoice reference presence.
- Negative totals on documents labelled INVOICE.
- Missing required fields, unapproved vendors and mismatched PO owners.
- Bank-account mismatch against trusted vendor master: always review; never
  update the master from invoice or email instructions.
- Future dates, invoices more than 365 days old and dates before PO issuance.
- GST split types, component rates/amounts, printed tax and total arithmetic.
- Cross-currency comparison using a unique approved positive rate for the exact
  invoice date and currency direction; no silent default to a rate of 1.

The evaluation date is fixed at **2026-11-02**, so results do not change with the
computer's clock. Age thresholds, adjustment handling and bank routing are demo
policies. FX rates are fictional treasury fixtures, not market quotes. GST rates
and state pairs are supplied test assumptions for basic arithmetic checks, not a
complete GST compliance engine or product-specific tax classification.

Amounts and PO receipts are gross, including tax. Use currency conversion before
comparing foreign amounts with a PO. PO references include `issue_date` and
`currency`; vendor references include a fictional `bank_account`.

Run validation and regression checks from the project directory:

```bash
./zamp_venv/bin/python -m test_cases.validate_inbox
./zamp_venv/bin/python -m unittest test_cases.test_invoice_checks
```

These verify dataset counts, MIME/PDF hashes, duplicate relationships, supplier
styles, OCR routing on every page, page/document structure, positive controls,
and review-rule boundaries. They do not measure an OCR engine's accuracy.

## Invoice designs and email variety

Each supplier retains its own stationery: Northstar's navy product invoice,
Harbor's teal service invoice, Cedar's traditional service letter, Summit's plain
warehouse export and Brightline's print-studio layout. GST examples identify the
supplier's Indian branch. Emails mix formal, brief, informal, structured/HTML,
forwarded and follow-up messages. Presentation alone does not decide validity.

## API endpoints

`GET /emails`, `/emails/{id}`, `/emails/{id}/preview`,
`/emails/{id}/attachment`, `/emails/{id}/raw`, `/vendors`, `/purchase-orders`.

The full FX and policy references are in `procurement.json`.

## Sources consulted

These are original synthetic documents informed by public examples, not invoices
issued by real companies. Identities, accounts and financial data are fictional.

- [FreshBooks invoice anatomy](https://www.freshbooks.com/fbstaticprod-uploads/Newsletter-2025/FreshBooks-AnatomyOfAWinningInvoice.pdf): billing layout and sections.
- [Invoice Home examples](https://invoicehome.com/): varied supplier stationery.
- [CBIC invoice and note particulars](https://cbic-gst.gov.in/gst-invoice-rules.html): document-type and original-reference concepts.
- [GST IRP validation guidance](https://einvoice6.gst.gov.in/content/validation-rules-for-e-invoicing-that-you-must-take-care-to-avoid-errors/): tax component and arithmetic examples; fixture checks are a limited subset.
- [Income Tax Department ICDS guide](https://www.incometaxindia.gov.in/en/income-computation-and-disclosure-standards-icds-1): date-specific FX concept; demo rates are synthetic.
