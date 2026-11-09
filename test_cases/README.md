# Edge cases: 14 of 54 emails

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
| 51 | Corrupt PDF attachment | Unreadable PDF body with no recoverable pages; email MIME remains valid | Human review; request replacement |
| 52 | Password-protected PDF attachment | AES-256 encryption; password absent from message | Human review; request password through a trusted channel |
| 53 | Valid installments against PO-26053 | Two invoices: USD 440 + USD 660 = USD 1,100 PO value | Approve both; final balance USD 0 |
| 54 | Cumulative billing against PO-26054 | USD 660 then USD 550 against USD 1,100; second exceeds remaining balance by USD 110 | Approve first, review second |
Expected email-level totals are **41 approvals, 2 duplicates and 11 human reviews**.
Emails 49 and 50 now require review because of their added features. At document
level, email 47's complete second invoice can pass the supplied field checks;
review of its other documents must not be treated as a rejection of that invoice.

Positive controls among the ordinary emails:

- **12:** USD invoice matched to an INR PO using an approved, dated synthetic FX rate.
- **13:** INR invoice with correct IGST components for the supplied state pair.
- **18:** INR invoice with correct CGST/SGST amounts and a reconciled total.

The dataset contains **54 emails and 54 attachments**: **37 searchable PDFs, 15 image-only PDFs, one corrupt PDF and one encrypted PDF**. The readable inputs contain **56 billing documents across 57 pages**; the encrypted PDF has one additional page, and the corrupt file has no readable page count. Scan IDs remain unchanged. Supplier
stationery and duplicate relationships are preserved.

Evaluate dates against the fixed fixture date **2026-11-02**. The old-invoice
threshold of **365 days**, bank-change routing and adjustment routing are demo
business policies, not claims about statutory deadlines. FX rates are synthetic
reference values with explicit currency direction and invoice-date matching.

See [fixture guide](test_inputs/README.md) for running the demo and using the reference data.

Email 52’s synthetic test password is `DemoInvoice52!`. Validation verifies rejection of a wrong password and successful opening with this credential. Unreadable inputs have empty extracted fields and document lists; do not interpret these as missing business fields or attempt payment approval. Full generation includes both cases; `python -m test_cases.attachment_failures` appends them once to an existing 50-email fixture set.

Emails **53–54** each contain one searchable, two-page PDF with **two distinct invoices**, one per page. Process page 1 before page 2, retaining the approved invoice reservation when checking the second. These are incremental milestone charges, not cumulative totals to subtract. Each PO starts with `previously_invoiced: 0` and fully received value of USD 1,100. Email 53 ends at the PO limit; email 54’s second invoice triggers `PO_BALANCE_EXCEEDED` and `RECEIPT_BALANCE_EXCEEDED`. Do not reject its first invoice because the email as a whole requires review. Source fields remain separate from expected reservation history.

Run `./zamp_venv/bin/python -m test_cases.validate_inbox` to verify both sequential decisions with the application rules. Full generation includes all 54 emails. To append only these two cases to an existing 52-email fixture set, run `./zamp_venv/bin/python -m test_cases.installment_billing` once. The app’s trusted master also includes PO-26053 and PO-26054.
