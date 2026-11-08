import hmac
import json
import os
from contextlib import asynccontextmanager
from email import policy
from email.parser import BytesParser
from typing import Literal
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .settings import Settings
from .schemas import Correction, IngestRequest, RetryRequest, InvoiceExtraction, CaseSummary, CaseDetail, CasePage, IngestResult
from .invoice_service import Service, Conflict, NotFound


def install(app: FastAPI, settings=None, extractor=None):
    settings = settings or Settings()
    service = Service(settings, extractor)
    app.state.processing = service
    old_lifespan = app.router.lifespan_context
    @asynccontextmanager
    async def lifespan(application):
        async with old_lifespan(application):
            if settings.worker_enabled: service.start()
            try: yield
            finally: service.stop()
    app.router.lifespan_context = lifespan
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=['GET', 'POST'], allow_headers=['Content-Type', 'X-API-Key', 'X-Reviewer-Key', 'X-Filename', 'X-Sender'])

    @app.middleware('http')
    async def api_auth(request, call_next):
        if request.method != 'OPTIONS' and request.url.path not in {'/health', '/docs', '/docs/oauth2-redirect', '/redoc', '/openapi.json'} and settings.api_key:
            if not hmac.compare_digest(request.headers.get('x-api-key', ''), settings.api_key):
                return JSONResponse(status_code=401, content={'error': {'code': 'UNAUTHORIZED', 'message': 'Valid X-API-Key required.'}})
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(Conflict)
    async def conflict(request, exc):
        return JSONResponse(status_code=409, content={'error': {'code': 'CONFLICT', 'message': str(exc)}})
    @app.exception_handler(NotFound)
    async def not_found(request, exc):
        return JSONResponse(status_code=404, content={'error': {'code': 'NOT_FOUND', 'message': str(exc)}})
    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse(status_code=400, content={'error': {'code': 'INVALID_REQUEST', 'message': str(exc)}})

    def reviewer(x_reviewer_key: str = Header(default='')):
        # No anonymous review writes, even in local mode.
        if not settings.reviewer_key:
            raise HTTPException(503, 'REVIEWER_API_KEY must be configured for review actions.')
        if not hmac.compare_digest(x_reviewer_key, settings.reviewer_key):
            raise HTTPException(403, 'Valid X-Reviewer-Key required.')
        return 'reviewer:' + __import__('hashlib').sha256(x_reviewer_key.encode()).hexdigest()[:12]

    def case(job_id):
        data = service.store.get(job_id)
        if data is None: raise NotFound('Case not found')
        return data

    async def read_limited(request, maximum):
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > maximum: raise HTTPException(413, 'Request exceeds size limit.')
            chunks.append(chunk)
        return b''.join(chunks)

    @app.get('/health', tags=['system'])
    def health():
        return {'status': 'ok', 'worker_enabled': settings.worker_enabled,
                'worker_alive': bool(service.thread and service.thread.is_alive()),
                'extraction_configured': bool(settings.model)}

    router = APIRouter(prefix='/api/v1', tags=['processing'])
    @router.get('/schema/extraction')
    def extraction_schema():
        return InvoiceExtraction.model_json_schema()

    @router.post('/ingest/email', status_code=202, response_model=IngestResult)
    def ingest_email(body: IngestRequest):
        """Queue the attachment from an existing inbox email. Idempotent by PDF hash."""
        return service.ingest_email(body.email_id)

    @router.post('/ingest/pdf', status_code=202, response_model=IngestResult, openapi_extra={'requestBody': {'required': True, 'content': {'application/pdf': {'schema': {'type': 'string', 'format': 'binary'}}}}})
    async def ingest_pdf(request: Request, x_filename: str = Header(default='invoice.pdf', max_length=255),
                         x_sender: str = Header(default='', max_length=320)):
        """Raw application/pdf request body. Poll the returned case ID for progress."""
        content = await read_limited(request, settings.max_pdf_bytes)
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(service.ingest, content, x_sender, os.path.basename(x_filename))

    @router.post('/ingest/eml', status_code=202, openapi_extra={'requestBody': {'required': True, 'content': {'message/rfc822': {'schema': {'type': 'string', 'format': 'binary'}}}}})
    async def ingest_eml(request: Request):
        """Raw message/rfc822 body. Every PDF attachment gets an independent case."""
        content = await read_limited(request, settings.max_pdf_bytes * 2)
        message = BytesParser(policy=policy.default).parsebytes(content)
        attachments = []
        for part in message.walk():
            if part.get_content_type() == 'application/pdf':
                attachments.append((part.get_payload(decode=True), part.get_filename() or 'invoice.pdf'))
        if not attachments: raise HTTPException(422, 'Email contains no PDF attachments.')
        if len(attachments) > 20: raise HTTPException(422, 'Email contains more than 20 PDF attachments.')
        if any(not data or len(data) > settings.max_pdf_bytes for data, _ in attachments):
            raise HTTPException(413, 'Email contains empty or oversized PDF attachments.')
        from starlette.concurrency import run_in_threadpool
        results = []
        for data, filename in attachments:
            results.append(await run_in_threadpool(service.ingest, data, str(message.get('From', '')), os.path.basename(filename)))
        return {'items': results}

    @router.get('/cases', response_model=CasePage)
    def cases(status: Literal['queued', 'processing', 'review', 'approved', 'duplicate'] | None = None,
              limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0)):
        where, args = ('WHERE status=?', [status]) if status else ('', [])
        with service.store.connect() as c:
            total = c.execute(f'SELECT count(*) FROM jobs {where}', args).fetchone()[0]
            rows = c.execute(f'SELECT * FROM jobs {where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?', args + [limit, offset]).fetchall()
        return {'items': [{k:v for k,v in service.store.decode(r).items() if k in CaseSummary.model_fields} for r in rows], 'total': total, 'limit': limit, 'offset': offset}

    @router.get('/review-queue', response_model=CasePage)
    def queue(limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0)):
        return cases('review', limit, offset)

    @router.get('/stats')
    def stats():
        with service.store.connect() as c:
            return {'counts': {r['status']: r['n'] for r in c.execute('SELECT status,count(*) n FROM jobs GROUP BY status')}}

    @router.get('/cases/{job_id}', response_model=CaseDetail)
    def detail(job_id: str): return case(job_id)

    @router.get('/cases/{job_id}/document')
    def document(job_id: str):
        case(job_id)
        with service.store.connect() as c:
            content = c.execute('SELECT content FROM jobs WHERE id=?', (job_id,)).fetchone()[0]
        return Response(content, media_type='application/pdf', headers={'Content-Disposition': 'inline; filename="invoice.pdf"'})

    @router.get('/cases/{job_id}/audit')
    def audit(job_id: str, after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=500)):
        case(job_id)
        with service.store.connect() as c:
            rows = c.execute('SELECT * FROM audit WHERE job_id=? AND id>? ORDER BY id LIMIT ?', (job_id, after, limit)).fetchall()
        return {'items': [{**dict(r), 'payload': json.loads(r['payload'])} for r in rows]}

    @router.post('/cases/{job_id}/corrections', response_model=CaseDetail)
    def correct(job_id: str, body: Correction, actor=Depends(reviewer)):
        """Attest the full corrected extraction; rerun validation and business rules, never OCR."""
        return service.validate(job_id, body.extraction, actor, body.expected_version, body.note)

    @router.post('/cases/{job_id}/retry', response_model=CaseDetail)
    def retry(job_id: str, body: RetryRequest, actor=Depends(reviewer)):
        """Retry a repaired processing dependency. Not available for business exceptions."""
        return service.retry(job_id, body.expected_version, body.note, actor)

    @router.post('/reset')
    def reset(actor=Depends(reviewer)):
        """Clear processing state and reload trusted reference data; preserve fixtures."""
        return service.reset()

    @router.get('/references')
    def references():
        return service.references()

    app.include_router(router)
    original_openapi = app.openapi
    def openapi():
        schema = original_openapi()
        schemes = schema.setdefault('components', {}).setdefault('securitySchemes', {})
        schemes['ApiKey'] = {'type': 'apiKey', 'in': 'header', 'name': 'X-API-Key'}
        schemes['ReviewerKey'] = {'type': 'apiKey', 'in': 'header', 'name': 'X-Reviewer-Key'}
        for path, methods in schema['paths'].items():
            for operation in methods.values():
                if isinstance(operation, dict) and path != '/health':
                    security = {'ApiKey': []} if settings.api_key else {}
                    if path.endswith(('/corrections', '/retry', '/reset')):
                        security['ReviewerKey'] = []
                    operation['security'] = [security] if security else []
        return schema
    app.openapi = openapi
    return service
