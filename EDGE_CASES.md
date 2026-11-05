# Edge cases: 10 of 50 emails

Emails 1–40 are routine, valid invoices from five approved suppliers. Distinct
invoice numbers from the same supplier are legitimate separate invoices.

| Email | Case | Expected outcome |
| --- | --- | --- |
| 41 | Follow-up with the exact PDF from email 1 | Duplicate |
| 42 | Reissued PDF with the same vendor and invoice number as email 2 | Duplicate |
| 43 | Punctuation removed from email 3's invoice number; other details match | Human review for possible duplicate |
| 44 | Unregistered vendor claims another supplier's PO | Human review |
| 45 | Northstar display name with a lookalike sender domain | Human review |
| 46 | Invoice number missing from email and PDF | Human review |
| 47 | Final amount due missing from email and PDF | Human review |
| 48 | Currency unspecified in email and PDF | Human review |
| 49 | Contact name, address and phone missing; critical fields complete | Approve |
| 50 | Vague email; PDF complete except optional due date; Net 30 on vendor master | Approve |

Expected totals: 42 approvals, 2 duplicates and 6 human reviews. Ground truth
explicitly marks the 10 edge cases using `is_edge_case`; edge case does not always
mean invalid. Process emails in ID order to populate duplicate history. PO
amounts and receipts are gross USD values; each unique legitimate invoice has
its own PO, avoiding accidental cumulative overruns.

PDF format is independent of business exceptions. There are 35 searchable PDFs
and 15 image-only scanned PDFs. Edge cases 43 and 47 require OCR; the other scans
are routine invoices. Supplier designs remain consistent across digital and
scanned versions. Expected business outcomes are unchanged after extraction.
