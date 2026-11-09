"""Create two-invoice bundles for valid installments and cumulative PO overbilling."""
from email.message import EmailMessage
from email.policy import SMTP
import hashlib
import json
from pathlib import Path
import sqlite3

from .invoice_layouts import compose_pdf, STYLES
from .invoice_scenarios import bundled_invoice


def append_installment_billing(inputs, db, truth, procurement):
    for idx, scenario, subtotals in ((53, 'valid_installment_billing', (400, 600)),
                                     (54, 'cumulative_po_overrun', (600, 500))):
        if any(t['id'] == idx for t in truth):
            raise ValueError(f'Email {idx} already exists')
        po = dict(number=f'PO-26{idx:03}', vendor_id='V002', amount=1100,
                  received_amount=1100, previously_invoiced=0, tolerance_percent=2,
                  currency='USD', issue_date='2026-10-01')
        documents = []
        billed = 0
        for part, subtotal in enumerate(subtotals, 1):
            fields = bundled_invoice()
            fields.update(number=f'HI-2026-{idx:04}-{part}', po=po['number'],
                          date=f'2026-10-{20 + part:02}', due_date=f'2026-11-{19 + part:02}',
                          description=f'IT support milestone {part} of 2',
                          unit_price=subtotal, subtotal=subtotal, tax=subtotal / 10,
                          total=subtotal * 1.1)
            fields['total'] = round(fields['total'], 2)
            cumulative = round(billed + fields['total'], 2)
            overrun = cumulative > po['amount']
            documents.append(dict(fields=fields, page_range=[part, part],
                                  expected='human_review' if overrun else 'approve',
                                  previously_invoiced=billed, cumulative_billed=cumulative,
                                  remaining_po_before=round(po['amount'] - billed, 2),
                                  expected_review_codes=['PO_BALANCE_EXCEEDED', 'RECEIPT_BALANCE_EXCEEDED'] if overrun else [],
                                  reason='Second invoice exceeds remaining PO and received balance.' if overrun else 'Installment fits remaining PO and received balance.'))
            billed = cumulative
        data = compose_pdf(documents[0]['fields'], 'V002', extra=documents[1]['fields'])
        stem = f'{idx}_{scenario}'
        attachment = inputs / 'attachments' / f'{stem}.pdf'
        eml = inputs / 'emails' / f'{stem}.eml'
        if attachment.exists() or eml.exists():
            raise FileExistsError(stem)
        subject = f'Two milestone invoices for {po["number"]}'
        sender = 'billing@harbor.example'
        msg = EmailMessage(policy=SMTP)
        msg['From'] = f'Harbor IT Services <{sender}>'
        msg['To'] = 'Accounts Payable <accounts-payable@buyer.example>'
        msg['Subject'] = subject
        msg['Date'] = f'Mon, 02 Nov 2026 17:{idx:02}:00 +0000'
        msg['Message-ID'] = f'<ar.202611.{idx:04}@harbor.example>'
        msg.set_content(f'Hello AP team,\n\nAttached are two separate milestone invoices for {po["number"]}, one per page. Please process milestone 1 before milestone 2. Each invoice bills only that milestone; amounts are not running totals.\n\nThank you,\nDaniel Reed\nHarbor IT Services\n')
        msg.add_attachment(data, maintype='application', subtype='pdf', filename=f'Milestone_invoices_{idx}.pdf')
        sha = hashlib.sha256(data).hexdigest()
        db.execute('INSERT INTO emails(id,scenario,sender,subject,eml_path,attachment_path,sha256) VALUES (?,?,?,?,?,?,?)',
                   (idx, scenario, sender, subject, f'test_inputs/emails/{eml.name}', f'test_inputs/attachments/{attachment.name}', sha))
        db.execute('INSERT INTO purchase_orders VALUES (?,?)', (po['number'], json.dumps(po)))
        procurement['purchase_orders'].append(po)
        attachment.write_bytes(data)
        eml.write_bytes(msg.as_bytes())
        truth.append(dict(id=idx, scenario=scenario, is_edge_case=True, vendor_id='V002',
                          fields=documents[0]['fields'].copy(), missing_fields=[],
                          added_features=['multiple_invoices_one_pdf', scenario], documents=documents,
                          page_count=2, email_style='structured', pdf_kind='text_extractable',
                          requires_ocr=False, template_id=STYLES['V002'][0], scan_variation=None,
                          expected='approve' if idx == 53 else 'human_review',
                          reason='Both installments fit the PO; cumulative billing equals USD 1,100.' if idx == 53 else 'First invoice passes; second takes cumulative billing to USD 1,210 against a USD 1,100 PO.',
                          sha256=sha, duplicate_of=None))


def main():
    inputs = Path(__file__).resolve().parent / 'test_inputs'
    expected = inputs / 'ground_truth/expected.json'
    reference = inputs / 'ground_truth/procurement.json'
    truth = json.loads(expected.read_text())
    procurement = json.loads(reference.read_text())
    with sqlite3.connect(inputs / 'inbox.sqlite3') as db:
        append_installment_billing(inputs, db, truth, procurement)
    expected.write_text(json.dumps(truth, indent=2) + '\n')
    reference.write_text(json.dumps(procurement, indent=2) + '\n')


if __name__ == '__main__':
    main()
