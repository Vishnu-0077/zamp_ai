"""Validate fixture integrity and searchable versus OCR-only PDF routing."""
from collections import Counter, defaultdict
from email import policy
from email.parser import BytesParser
from pathlib import Path
import hashlib
import json
import sqlite3
import pymupdf
from .invoice_layouts import SCAN_IDS, render, compose_pdf
from backend.invoice_checks import check_document

ROOT = Path(__file__).resolve().parent

def validate():
    base=ROOT/'test_inputs'
    truth=json.loads((base/'ground_truth/expected.json').read_text())
    with sqlite3.connect(base/'inbox.sqlite3') as db:
        db.row_factory=sqlite3.Row
        rows=list(db.execute('SELECT * FROM emails ORDER BY id'))
    assert len(rows)==len(truth)==52
    assert len(list((base/'emails').glob('*.eml')))==52
    assert len(list((base/'attachments').glob('*.pdf')))==52
    assert sum(t['is_edge_case'] for t in truth)==12
    assert Counter(t['expected'] for t in truth)=={'approve':40,'duplicate':2,'human_review':10}
    assert {t['id'] for t in truth if t['requires_ocr']}==SCAN_IDS
    templates=defaultdict(set)
    procurement=json.loads((base/'ground_truth/procurement.json').read_text())
    pos={p['number']:p for p in procurement['purchase_orders']}
    vendors={v['id']:v for v in procurement['vendors']}
    codes_by_id={}
    for row,t in zip(rows,truth):
        assert row['id']==t['id']
        data=(ROOT/row['attachment_path']).read_bytes()
        assert hashlib.sha256(data).hexdigest()==row['sha256']==t['sha256']
        msg=BytesParser(policy=policy.default).parsebytes((ROOT/row['eml_path']).read_bytes())
        attachments=list(msg.iter_attachments())
        assert len(attachments)==1 and attachments[0].get_payload(decode=True)==data
        body=msg.get_body(preferencelist=('plain',)).get_content()
        assert body.strip()
        if t['id'] in (51, 52):
            assert t['fields'] == {} and t['documents'] == []
            if t['id'] == 51:
                assert t['pdf_kind'] == 'corrupted' and t['page_count'] is None
                try:
                    with pymupdf.open(stream=data, filetype='pdf') as damaged:
                        assert damaged.page_count == 0, 'Corrupt PDF unexpectedly has pages'
                except pymupdf.FileDataError:
                    pass
            else:
                from .attachment_failures import TEST_PASSWORD
                assert t['pdf_kind'] == 'password_protected'
                assert TEST_PASSWORD not in body
                with pymupdf.open(stream=data, filetype='pdf') as locked:
                    assert locked.needs_pass
                    assert not locked.authenticate('incorrect-password')
                    assert locked.authenticate(TEST_PASSWORD)
                    assert locked.page_count == t['page_count'] == 1
                    assert 'HI-2026-0052' in locked[0].get_text()
            continue
        with pymupdf.open(stream=data,filetype='pdf') as pdf:
            assert len(pdf)==t['page_count']
            extracted='\n'.join(page.get_text() for page in pdf)
            if t['requires_ocr']:
                assert not extracted.strip(), (t['id'],'Scan leaked extractable text')
                for page in pdf:
                    assert page.get_images(), (t['id'],'Scan contains no raster image')
                    assert not page.get_fonts(), (t['id'],'Scan has a text font resource')
            else:
                fields=t['fields']
                assert fields['vendor'].lower() in ' '.join(extracted.lower().split()), (t['id'], 'vendor name')
                assert fields['number'] in extracted if 'number' in fields else '001-2026-0046' not in extracted
                for key in ('date','po'):
                    assert fields[key] in extracted,(t['id'],key)
                for key in ('subtotal','tax','total'):
                    if key in fields:
                        assert f"{fields[key]:,.2f}" in extracted,(t['id'],key)
                if 'currency' not in fields:
                    assert 'USD' not in extracted+body
                for key in t['missing_fields']:
                    if key in ('due_date','contact','address','phone'):
                        assert {'due_date':'Due date','contact':'Accounts receivable','address':'Market Street','phone':'+1-202-555-0142'}[key] not in extracted
                # No words may be clipped off the page.
                for x0,y0,x1,y1,*_ in pdf[0].get_text('words'):
                    assert 0<=x0<x1<=612 and 0<=y0<y1<=792,(t['id'],'clipped text')
        if t['vendor_id']:
            templates[t['vendor_id']].add(t['template_id'])
        if t['expected']=='approve':
            po=pos[t['fields']['po']]
            assert po['vendor_id']==t['vendor_id']
            if t['fields'].get('currency') == po['currency']:
                assert po['amount']==t['fields']['total']
        findings=check_document(t['fields'],vendors.get(t['vendor_id']),pos.get(t['fields']['po']),procurement['fx_rates'],procurement['validation_policy'])
        codes_by_id[t['id']]={f['code'] for f in findings}
        if t['expected']=='approve':
            assert not findings,(t['id'],findings)
        elif t['expected']=='human_review' and t['id']!=43:
            assert findings,t['id']
        for document in t['documents']:
            assert document['page_range'][1]<=t['page_count']
            if document['expected']=='approve':
                fields=document['fields']
                assert not check_document(fields,vendors.get(t['vendor_id']),pos.get(fields['po']),procurement['fx_rates'],procurement['validation_policy'])
    assert sum(len(t['documents']) for t in truth)==52
    assert sum(t['page_count'] for t in truth[:50])==53
    required={44:{'negative_invoice','unapproved_vendor'},45:{'bank_account_changed'},
              46:{'future_invoice_date','missing_number'},47:{'missing_total'},
              48:{'missing_currency','gst_split_total','gst_component_amount','invoice_before_po'},
              49:{'adjustment_document'},50:{'old_invoice','missing_fx_rate'}}
    for idx,codes in required.items():
        assert codes<=codes_by_id[idx],(idx,codes_by_id[idx])
    for idx in (12,13,18):assert not codes_by_id[idx],(idx,codes_by_id[idx])
    debit=truth[46]['documents'][2]['fields']
    assert debit['document_type']=='DEBIT NOTE'
    assert 'adjustment_document' in {f['code'] for f in check_document(debit,vendors['V002'],pos[debit['po']],procurement['fx_rates'],procurement['validation_policy'])}
    # Verify source layout before rasterization: the amount due occurs only on page 2.
    with pymupdf.open(stream=compose_pdf(truth[42]['fields'],'V003',multipage=True),filetype='pdf') as pdf:
        assert 'Total payable' not in pdf[0].get_text() and 'AMOUNT DUE:' not in pdf[0].get_text()
        assert 'AMOUNT DUE:' in pdf[1].get_text()
        assert truth[42]['fields']['number'] in pdf[0].get_text()+pdf[1].get_text()
    # Multi-invoice PDF must preserve the missing total in document 1 and the debit identity in document 2.
    with pymupdf.open(stream=compose_pdf(truth[46]['fields'],'V002',extra=[truth[46]['documents'][1]['fields'],debit]),filetype='pdf') as pdf:
        assert 'AMOUNT DUE' not in pdf[0].get_text()
        assert 'INVOICE' in pdf[1].get_text() and 'HI-2026-EXTRA-0047' in pdf[1].get_text()
        assert 'DEBIT NOTE' in pdf[2].get_text() and debit['number'] in pdf[2].get_text()
    assert all(len(styles)==1 for styles in templates.values())
    assert truth[40]['sha256']==truth[0]['sha256']
    assert truth[41]['sha256']!=truth[1]['sha256']
    assert truth[41]['fields']==truth[1]['fields']
    assert truth[42]['fields']['number']==truth[2]['fields']['number'].replace('-','')
    print('PASS: 52 emails, 40 routine + 12 edge cases; 35 searchable PDFs + 15 image-only PDFs + 1 corrupt + 1 encrypted; 52 readable documents across 53 readable pages; notes, FX, GST, date and bank checks; supplier templates, MIME attachments and duplicates.')

if __name__=='__main__':
    validate()
