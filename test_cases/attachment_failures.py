"""Append unreadable attachment fixtures without changing emails 1–50."""
from email.message import EmailMessage
from email.policy import SMTP
import hashlib
import json
import sqlite3

import pymupdf

# Synthetic fixture credential; intentionally absent from the email and PDF filename.
TEST_PASSWORD = 'DemoInvoice52!'


def append_attachment_failures(inputs, db, truth):
    """Used by both full generation and the incremental fixture update."""
    for idx, scenario in ((51, 'corrupted_attachment'), (52, 'password_protected_attachment')):
        if any(item['id'] == idx for item in truth):
            raise ValueError(f'Email {idx} already exists')
        if idx == 51:
            # PDF header followed by a destroyed body: no recoverable page tree.
            data = b'%PDF-1.7\n% Damaged transfer: object stream and cross-reference table missing.\n'
            reason = 'PDF is corrupt and cannot be opened; request a replacement and route to human review.'
        else:
            with pymupdf.open() as pdf:
                page = pdf.new_page()
                page.insert_text((50, 60), 'Harbor IT Services - INVOICE HI-2026-0052')
                page.insert_text((50, 90), 'Synthetic password-protected invoice for attachment access testing.')
                page.insert_text((50, 120), 'Invoice date: 2026-10-22 | PO: PO-26052')
                page.insert_text((50, 150), 'Subtotal: USD 850.00 | Tax: USD 85.00 | Total: USD 935.00')
                data = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                                  owner_pw='DemoOwner52!', user_pw=TEST_PASSWORD,
                                  permissions=0)
            reason = 'PDF requires an unavailable password; request it through a trusted channel and route to human review.'
        stem = f'{idx}_{scenario}'
        attachment = inputs / 'attachments' / f'{stem}.pdf'
        eml = inputs / 'emails' / f'{stem}.eml'
        if attachment.exists() or eml.exists():
            raise FileExistsError(stem)
        sender = 'billing@northstar.example' if idx == 51 else 'billing@harbor.example'
        subject = f'Invoice attached - November submission {idx}'
        msg = EmailMessage(policy=SMTP)
        msg['From'] = sender
        msg['To'] = 'Accounts Payable <accounts-payable@buyer.example>'
        msg['Subject'] = subject
        msg['Date'] = f'Tue, 03 Nov 2026 10:{idx - 50:02}:00 +0000'
        msg['Message-ID'] = f'<ar.202611.{idx:04}@{sender.split("@")[1]}>'
        msg.set_content('Hello AP team,\n\nPlease find our invoice attached for processing.\n\nThank you,\nAccounts receivable\n')
        msg.add_attachment(data, maintype='application', subtype='pdf', filename=f'Invoice_{idx}.pdf')
        sha = hashlib.sha256(data).hexdigest()
        db.execute('INSERT INTO emails(id,scenario,sender,subject,eml_path,attachment_path,sha256) VALUES (?,?,?,?,?,?,?)',
                   (idx, scenario, sender, subject, f'test_inputs/emails/{eml.name}',
                    f'test_inputs/attachments/{attachment.name}', sha))
        attachment.write_bytes(data)
        eml.write_bytes(msg.as_bytes())
        truth.append(dict(id=idx, scenario=scenario, is_edge_case=True,
                          vendor_id='V001' if idx == 51 else 'V002', fields={},
                          missing_fields=[], added_features=[scenario], documents=[],
                          page_count=None if idx == 51 else 1, email_style='exception_message',
                          pdf_kind='corrupted' if idx == 51 else 'password_protected',
                          requires_ocr=False, template_id=None, scan_variation=None,
                          expected='human_review', reason=reason, sha256=sha, duplicate_of=None))


def main():
    from pathlib import Path
    inputs = Path(__file__).resolve().parent / 'test_inputs'
    expected = inputs / 'ground_truth' / 'expected.json'
    truth = json.loads(expected.read_text())
    with sqlite3.connect(inputs / 'inbox.sqlite3') as db:
        append_attachment_failures(inputs, db, truth)
    expected.write_text(json.dumps(truth, indent=2) + '\n')


if __name__ == '__main__':
    main()
