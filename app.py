"""Read-only simulated inbox. No extraction or approval logic is implemented here."""
from pathlib import Path
import sqlite3, json
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from email import policy
from email.parser import BytesParser

ROOT=Path(__file__).resolve().parent
app=FastAPI(title='Synthetic Vendor Inbox')

def query(sql, args=()):
    with sqlite3.connect(ROOT/'test_inputs'/'inbox.sqlite3') as db:
        db.row_factory=sqlite3.Row
        return [dict(row) for row in db.execute(sql,args).fetchall()]

@app.get('/', include_in_schema=False)
def inbox_page():
    return FileResponse(ROOT/'inbox.html', media_type='text/html')

@app.get('/emails')
def emails(): return query('SELECT * FROM emails ORDER BY id')

@app.get('/emails/{email_id}')
def email(email_id:int):
    rows=query('SELECT * FROM emails WHERE id=?',(email_id,))
    if not rows: raise HTTPException(404,'Email not found')
    return rows[0]

@app.get('/emails/{email_id}/preview')
def preview(email_id: int):
    path = ROOT/email(email_id)['eml_path']
    message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    body = message.get_body(preferencelist=('plain',))
    return {'id': email_id, 'from': str(message.get('From', '')),
            'to': str(message.get('To', '')), 'subject': str(message.get('Subject', '')),
            'date': str(message.get('Date', '')),
            'body': body.get_content() if body else 'No plain-text message available.'}

@app.get('/emails/{email_id}/attachment')
def attachment(email_id:int):
    path=ROOT/email(email_id)['attachment_path']
    return FileResponse(path,media_type='application/pdf',filename=path.name,content_disposition_type='inline')

@app.get('/emails/{email_id}/raw')
def raw(email_id:int):
    path=ROOT/email(email_id)['eml_path']
    return FileResponse(path,media_type='message/rfc822',filename=path.name)

@app.get('/vendors')
def vendors(): return [json.loads(r['data']) for r in query('SELECT data FROM vendors')]

@app.get('/purchase-orders')
def purchase_orders(): return [json.loads(r['data']) for r in query('SELECT data FROM purchase_orders')]
