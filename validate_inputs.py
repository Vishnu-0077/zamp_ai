"""Validate fixture integrity and searchable versus OCR-only PDF routing."""
from collections import Counter, defaultdict
from email import policy
from email.parser import BytesParser
from pathlib import Path
import hashlib
import json
import sqlite3
import pymupdf
from invoice_layouts import SCAN_IDS

ROOT = Path(__file__).resolve().parent

def validate():
    base=ROOT/'test_inputs'
    truth=json.loads((base/'ground_truth/expected.json').read_text())
    with sqlite3.connect(base/'inbox.sqlite3') as db:
        db.row_factory=sqlite3.Row
        rows=list(db.execute('SELECT * FROM emails ORDER BY id'))
    assert len(rows)==len(truth)==50
    assert len(list((base/'emails').glob('*.eml')))==50
    assert len(list((base/'attachments').glob('*.pdf')))==50
    assert sum(t['is_edge_case'] for t in truth)==10
    assert Counter(t['expected'] for t in truth)=={'approve':42,'duplicate':2,'human_review':6}
    assert {t['id'] for t in truth if t['requires_ocr']}==SCAN_IDS
    templates=defaultdict(set)
    procurement=json.loads((base/'ground_truth/procurement.json').read_text())
    pos={p['number']:p for p in procurement['purchase_orders']}
    for row,t in zip(rows,truth):
        assert row['id']==t['id']
        data=(ROOT/row['attachment_path']).read_bytes()
        assert hashlib.sha256(data).hexdigest()==row['sha256']==t['sha256']
        msg=BytesParser(policy=policy.default).parsebytes((ROOT/row['eml_path']).read_bytes())
        attachments=list(msg.iter_attachments())
        assert len(attachments)==1 and attachments[0].get_payload(decode=True)==data
        body=msg.get_body(preferencelist=('plain',)).get_content()
        assert body.strip()
        with pymupdf.open(stream=data,filetype='pdf') as pdf:
            assert len(pdf)==1
            extracted=pdf[0].get_text()
            if t['requires_ocr']:
                assert not extracted.strip(), (t['id'],'Scan leaked extractable text')
                assert pdf[0].get_images(), (t['id'],'Scan contains no raster image')
                assert not pdf[0].get_fonts(), (t['id'],'Scan has a text font resource')
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
            assert po['vendor_id']==t['vendor_id'] and po['amount']==t['fields']['total']
    assert all(len(styles)==1 for styles in templates.values())
    assert truth[40]['sha256']==truth[0]['sha256']
    assert truth[41]['sha256']!=truth[1]['sha256']
    assert truth[41]['fields']==truth[1]['fields']
    assert truth[42]['fields']['number']==truth[2]['fields']['number'].replace('-','')
    print('PASS: 50 emails, 40 routine + 10 edge cases; 35 searchable PDFs + 15 image-only PDFs; supplier templates, MIME attachments, hashes, omissions, duplicates, PO matches and page bounds.')

if __name__=='__main__':
    validate()
