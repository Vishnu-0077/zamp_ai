"""Generate 50 fictional, realistic AP emails: 40 routine and 10 edge cases."""
from pathlib import Path
from email.message import EmailMessage
from email.policy import SMTP
from datetime import datetime, timezone, timedelta
import hashlib
import io
import json
import sqlite3
from invoice_layouts import render, scan_pdf, SCAN_IDS, STYLES

ROOT = Path(__file__).resolve().parent
INPUTS = ROOT / 'test_inputs'

VENDORS = [
    dict(id='V001', name='Northstar Office Supplies', domain='northstar.example', approved=True, contact='Maya Chen', item='A4 copier paper, cartons', price=32, quantity=8),
    dict(id='V002', name='Harbor IT Services', domain='harbor.example', approved=True, contact='Daniel Reed', item='Managed IT support, monthly retainer', price=850, quantity=1),
    dict(id='V003', name='Cedar Facilities', domain='cedar.example', approved=True, contact='Priya Shah', item='Weekly office cleaning visits', price=125, quantity=4),
    dict(id='V004', name='Summit Packaging', domain='summit.example', approved=True, contact='Alex Morgan', item='Recycled shipping cartons, bundles', price=48, quantity=6),
    dict(id='V005', name='Brightline Print Studio', domain='brightline.example', approved=True, contact='Sam Wilson', item='Product information leaflets, batches', price=75, quantity=3),
]
EDGE_CASES = [
    ('exact_duplicate', 'duplicate', 'Byte-identical attachment to email 1.', 1),
    ('reissued_duplicate', 'duplicate', 'Same vendor and invoice number as email 2; different PDF layout.', 2),
    ('similar_invoice_number', 'human_review', 'Invoice number differs only by punctuation from email 3; same transaction details.', 3),
    ('unregistered_vendor', 'human_review', 'Vendor is absent from the approved vendor master; claimed PO belongs to another vendor.', None),
    ('lookalike_sender', 'human_review', 'Sender uses northstarr.example while claiming the approved Northstar identity.', None),
    ('missing_invoice_number', 'human_review', 'Invoice number absent from both message and attachment.', None),
    ('missing_total', 'human_review', 'Final amount due absent; do not silently approve an inferred total.', None),
    ('unclear_currency', 'human_review', 'Amounts have no currency in either email or attachment.', None),
    ('missing_optional_contact', 'approve', 'Contact person, street address and phone omitted; payment-critical fields are complete.', None),
    ('vague_email_optional_due_date', 'approve', 'Brief message; complete invoice except optional due date. Vendor terms supply Net 30.', None),
]



def generate():
    if (INPUTS / 'inbox.sqlite3').exists():
        raise SystemExit('test_inputs/inbox.sqlite3 already exists; refusing to overwrite the dataset.')
    for folder in ('emails', 'attachments', 'ground_truth'):
        (INPUTS / folder).mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(INPUTS / 'inbox.sqlite3')
    db.executescript("""CREATE TABLE emails (id INTEGER PRIMARY KEY, scenario TEXT, sender TEXT, subject TEXT, eml_path TEXT, attachment_path TEXT, sha256 TEXT, status TEXT DEFAULT 'received');
    CREATE TABLE vendors (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE purchase_orders (number TEXT PRIMARY KEY, data TEXT);""")
    vendors = [{k: v[k] for k in ('id', 'name', 'domain', 'approved')} | {'payment_terms': 'Net 30', 'currency': 'USD'} for v in VENDORS]
    pos, truth, originals, pdfs = [], [], {}, {}
    for idx in range(1, 51):
        edge = idx > 40
        scenario, expected, reason, duplicate_of = EDGE_CASES[idx - 41] if edge else ('routine_invoice', 'approve', 'Complete invoice for an approved vendor and fully received purchase order.', None)
        vendor = VENDORS[0] if idx == 45 else VENDORS[(idx - 1) % len(VENDORS)]
        issue = datetime(2026, 10, 12, tzinfo=timezone.utc) + timedelta(days=(idx - 1) // 5)
        quantity = vendor['quantity'] + (idx - 1) // 5
        subtotal = quantity * vendor['price']
        fields = dict(document_type='INVOICE', vendor=vendor['name'], number=f"{vendor['id'][1:]}-2026-{idx:04}", date=issue.date().isoformat(), due_date=(issue + timedelta(days=30)).date().isoformat(), po=f'PO-{26000 + idx}', description=vendor['item'], quantity=quantity, unit_price=vendor['price'], subtotal=subtotal, tax=round(subtotal * .1, 2), total=round(subtotal * 1.1, 2), currency='USD', terms='Net 30', contact=vendor['contact'], address=f'{100 + int(vendor["id"][1:])} Market Street, Portland, OR 97205', phone='+1-202-555-0142')
        if duplicate_of:
            vendor, original = originals[duplicate_of]
            fields = original.copy()
            if idx == 43:
                fields['number'] = fields['number'].replace('-', '')
        elif idx != 44:
            pos.append(dict(number=fields['po'], vendor_id=vendor['id'], amount=fields['total'], received_amount=fields['total'], previously_invoiced=0, tolerance_percent=2, currency='USD'))
        if idx == 44:
            fields.update(vendor='Apex Business Trading', number='ABT-7619', po='PO-26001')
        omissions = {46: ['number'], 47: ['total'], 48: ['currency'], 49: ['contact', 'address', 'phone'], 50: ['due_date']}.get(idx, [])
        for key in omissions:
            fields.pop(key)
        sender = 'billing@' + vendor['domain']
        display = fields['vendor']
        if idx == 44:
            sender = 'accounts@apex-trading.example'
        if idx == 45:
            sender = 'billing@northstarr.example'
        number = fields.get('number', '')
        amount = f"{fields.get('currency', '')} {fields['total']:,.2f}".strip() if 'total' in fields else 'the amount shown on the attached invoice'
        subject = [f'Invoice {number} | {fields["po"]}', f'{display} - invoice {number}', f'Invoice for {fields["description"].lower()} ({number})', f'{fields["po"]}: invoice {number} attached'][idx % 4]
        openings = ['Hi Accounts Payable,', 'Hello AP team,', 'Good morning,', 'Hi team,']
        paragraphs = [f'Please find invoice {number} attached for {fields["description"].lower()}. The order reference is {fields["po"]}.', f'Attached is our invoice {number} against {fields["po"]}. Thank you for your recent order.', f'I have attached the invoice for {fields["description"].lower()}, as agreed with your purchasing team. Your reference is {fields["po"]}.', f'We have completed the work under {fields["po"]}. Please find the invoice attached for your records and payment.']
        body = f'{openings[idx % 4]}\n\n{paragraphs[idx % 4]}\n\nThe invoice amount is {amount}. Payment terms are Net 30. Please let us know if you need anything else to process this.\n\nMany thanks,\n{vendor["contact"]}\nAccounts receivable | {display}\n{sender}\n'
        email_style = ('formal', 'brief', 'informal', 'structured', 'forwarded')[idx % 5]
        if idx <= 40:
            if email_style == 'brief':
                body = f'Hi,\n\nInvoice attached for {fields["po"]}. Please confirm receipt.\n\nThanks,\n{vendor["contact"]}\n{display}\n'
            elif email_style == 'informal':
                body = f'hi team - sending this over from my phone.\n\n{fields["description"]} / ref {fields["po"]}\nattached the bill, thanks!\n\n{vendor["contact"].split()[0]}\nSent from my phone\n'
            elif email_style == 'structured':
                body = f'Hello Accounts Payable,\n\nPlease see the attached invoice.\n\nInvoice: {number}\nPO: {fields["po"]}\nAmount: {amount}\nTerms: Net 30\n\nThank you,\n{vendor["contact"]}\nAccounts receivable\n{display}\n'
            elif email_style == 'forwarded':
                body = f'Hi AP,\n\nPlease book the attached invoice for the order below. Receiving has confirmed delivery.\n\nThanks,\nJordan | Purchasing\n\n---------- Forwarded message ----------\nFrom: {display} <{sender}>\nSubject: Invoice {number}\nTo: purchasing@buyer.example\n\nHello Jordan,\nAttached is invoice {number} for {fields["po"]}, total {amount}.\nThanks again,\n{vendor["contact"]}\n'
        if idx in (41, 42, 43):
            subject = f'Re: Invoice {number} / {fields["po"]}'
            body = f'Hi team,\n\nFollowing up on invoice {number} for {amount}. I have attached a copy in case the original did not reach you. Could you confirm whether it is scheduled for payment?\n\nThanks,\n{vendor["contact"]}\n{display}\n'
        if idx == 49:
            body = f'Hello Accounts Payable,\n\nPlease find invoice {number} attached against {fields["po"]}. The total is {amount}, payable on Net 30 terms.\n\nThank you,\n{display}\n'
        if idx == 50:
            subject = 'Invoice attached'
            body = f'Hi team,\n\nHere is the invoice we discussed. Please let me know if you need anything else.\n\nThanks,\n{vendor["contact"]}\n{display}\n'
        layout_id = 'UNKNOWN' if idx == 44 else vendor['id']
        pdf_kind = 'image_only' if idx in SCAN_IDS else 'text_extractable'
        data = pdfs[1] if idx == 41 else render(fields, layout_id, reissued=idx == 42)
        if idx in SCAN_IDS:
            data = scan_pdf(data, idx)
        pdfs[idx] = data
        originals[idx] = (vendor, fields.copy())
        filename = f'{idx:02}_{scenario}' if edge else f'{idx:02}_invoice_{number}'
        pdf = INPUTS / 'attachments' / (filename + '.pdf')
        pdf.write_bytes(data)
        msg = EmailMessage(policy=SMTP)
        msg['From'] = f'{display} <{sender}>'
        msg['To'] = 'Accounts Payable <accounts-payable@buyer.example>'
        msg['Subject'] = subject
        msg['Date'] = (datetime(2026, 11, 2, 8, tzinfo=timezone.utc) + timedelta(minutes=idx * 31)).strftime('%a, %d %b %Y %H:%M:%S %z')
        msg['Message-ID'] = f'<ar.202611.{idx:04}@{sender.split("@")[1]}>'
        if duplicate_of:
            msg['In-Reply-To'] = f'<ar.202611.{duplicate_of:04}@{sender.split("@")[1]}>'
            msg['References'] = msg['In-Reply-To']
        msg.set_content(body)
        if idx <= 40 and email_style == 'structured':
            from html import escape
            msg.add_alternative('<html><body style="font-family:Arial;color:#253549"><h2>' + escape(display) + '</h2><div style="border-left:3px solid #147c73;padding:16px">' + escape(body).replace('\n', '<br>') + '</div></body></html>', subtype='html')
        msg.add_attachment(data, maintype='application', subtype='pdf', filename=f'Invoice_{number or "November"}.pdf')
        eml = INPUTS / 'emails' / (filename + '.eml')
        eml.write_bytes(msg.as_bytes())
        sha = hashlib.sha256(data).hexdigest()
        db.execute('INSERT INTO emails(id,scenario,sender,subject,eml_path,attachment_path,sha256) VALUES (?,?,?,?,?,?,?)', (idx, scenario, sender, subject, str(eml.relative_to(ROOT)), str(pdf.relative_to(ROOT)), sha))
        truth.append(dict(id=idx, scenario=scenario, is_edge_case=edge, vendor_id=None if idx == 44 else vendor['id'], fields=fields, missing_fields=omissions, email_style=email_style if idx <= 40 else "follow_up" if duplicate_of else "exception_message", pdf_kind=pdf_kind, requires_ocr=idx in SCAN_IDS, template_id=STYLES[layout_id][0], scan_variation=('clean', 'slight_skew', 'light_noise')[idx % 3] if idx in SCAN_IDS else None, expected=expected, reason=reason, sha256=sha, duplicate_of=duplicate_of))
    for vendor in vendors:
        db.execute('INSERT INTO vendors VALUES (?,?)', (vendor['id'], json.dumps(vendor)))
    for po in pos:
        db.execute('INSERT INTO purchase_orders VALUES (?,?)', (po['number'], json.dumps(po)))
    db.commit()
    db.close()
    (INPUTS / 'ground_truth' / 'expected.json').write_text(json.dumps(truth, indent=2) + '\n')
    (INPUTS / 'ground_truth' / 'procurement.json').write_text(json.dumps(dict(vendors=vendors, purchase_orders=pos), indent=2) + '\n')
    print('Created test_inputs: 50 emails, 50 PDFs, 40 routine invoices, exactly 10 edge cases.')

if __name__ == '__main__':
    generate()
