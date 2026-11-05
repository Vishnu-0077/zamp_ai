# Edge cases: 10 of 50 emails

Emails 1–40 remain routine, valid invoices. The original cases in emails 41–50
are retained, with realistic features layered onto selected cases.

| Email | Original case retained | Added feature | Expected email outcome |
| --- | --- | --- | --- |
| 41 | Exact duplicate of email 1 | Bank reference matches the original invoice | Duplicate |
| 42 | Reissued duplicate of email 2 | Same supplier stationery and business fields | Duplicate |
| 43 | Punctuation-only variation of email 3's invoice number | Two-page image-only invoice; total appears only on page 2 | Human review for possible duplicate, after OCR |
| 44 | Unregistered vendor claims another supplier's PO | Negative total still labelled INVOICE, not CREDIT NOTE | Human review |
| 45 | Northstar lookalike sender domain | Invoice bank account differs from vendor master | Human review; independently verify bank change |
| 46 | Invoice number missing from email and PDF | Future issue date: 2026-12-01 | Human review |
| 47 | Final amount due missing from the first invoice | Three-page image-only PDF: incomplete invoice, separate valid invoice, and debit note | Split documents, OCR, then review incomplete invoice and debit note |
| 48 | Currency missing from email and PDF | Incorrect CGST/SGST split and invoice dated before its PO | Human review |
| 49 | Optional contact name, address and phone missing | Credit note referencing invoice 004-2026-0004 | Human review through adjustment workflow; optional omissions alone do not block |
| 50 | Vague message and optional due date omitted | Very old EUR invoice; INR PO with no approved EUR-to-INR rate | Human review; vague wording/optional due date alone do not block |

Expected email-level totals are **40 approvals, 2 duplicates and 8 human reviews**.
Emails 49 and 50 now require review because of their added features. At document
level, email 47's complete second invoice can pass the supplied field checks;
review of its other documents must not be treated as a rejection of that invoice.

Positive controls among the ordinary emails:

- **12:** USD invoice matched to an INR PO using an approved, dated synthetic FX rate.
- **13:** INR invoice with correct IGST components for the supplied state pair.
- **18:** INR invoice with correct CGST/SGST amounts and a reconciled total.

The dataset still contains **35 searchable PDFs and 15 image-only PDFs**, with
**52 billing documents across 53 pages**. Scan IDs remain unchanged. Supplier
stationery and duplicate relationships are preserved.

Evaluate dates against the fixed fixture date **2026-11-02**. The old-invoice
threshold of **365 days**, bank-change routing and adjustment routing are demo
business policies, not claims about statutory deadlines. FX rates are synthetic
reference values with explicit currency direction and invoice-date matching.

See `test_inputs/README.md` for running the demo and using the reference data.
