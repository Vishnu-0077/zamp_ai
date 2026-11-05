"""Read-only inbox demo routes and document previews."""
import sqlite3, json
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from email import policy
from email.parser import BytesParser

from .settings import ROOT, TEST_ROOT

router = APIRouter(tags=["inbox"])

def query(sql, args=()):
    with sqlite3.connect(TEST_ROOT/'test_inputs'/'inbox.sqlite3') as db:
        db.row_factory=sqlite3.Row
        return [dict(row) for row in db.execute(sql,args).fetchall()]

@router.get('/', include_in_schema=False)
def inbox_page():
    return FileResponse(ROOT/'frontend'/'inbox.html', media_type='text/html')

@router.get('/emails')
def emails(): return query('SELECT * FROM emails ORDER BY id')

@router.get('/emails/{email_id}')
def email(email_id:int):
    rows=query('SELECT * FROM emails WHERE id=?',(email_id,))
    if not rows: raise HTTPException(404,'Email not found')
    return rows[0]

@router.get('/emails/{email_id}/preview')
def preview(email_id: int):
    path = TEST_ROOT/email(email_id)['eml_path']
    message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    body = message.get_body(preferencelist=('plain',))
    return {'id': email_id, 'from': str(message.get('From', '')),
            'to': str(message.get('To', '')), 'subject': str(message.get('Subject', '')),
            'date': str(message.get('Date', '')),
            'body': body.get_content() if body else 'No plain-text message available.'}

@router.get('/emails/{email_id}/attachment')
def attachment(email_id:int):
    path=TEST_ROOT/email(email_id)['attachment_path']
    return FileResponse(path,media_type='application/pdf',filename=path.name,content_disposition_type='inline')

@router.get('/emails/{email_id}/raw')
def raw(email_id:int):
    path=TEST_ROOT/email(email_id)['eml_path']
    return FileResponse(path,media_type='message/rfc822',filename=path.name)

@router.get('/vendors')
def vendors(): return [json.loads(r['data']) for r in query('SELECT data FROM vendors')]

@router.get('/purchase-orders')
def purchase_orders(): return [json.loads(r['data']) for r in query('SELECT data FROM purchase_orders')]
