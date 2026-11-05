import hashlib
import json
import logging
import sqlite3
import threading
import uuid
from .database import Store, now, dumps
from .invoice_extractor import LangChainExtractor, parse_pdf, ProcessingError, PROMPT_VERSION
from .schemas import InvoiceExtraction
from .invoice_rules import evaluate

log = logging.getLogger(__name__)

class Conflict(Exception): pass
class NotFound(Exception): pass


class Service:
    def __init__(self, settings, extractor=None):
        self.settings = settings
        self.store = Store(settings.db_path)
        self.extractor = extractor or LangChainExtractor(settings)
        self.stop_event = threading.Event()
        self.thread = None
        self.worker_lock = None

    def references(self):
        # Procurement reference file is explicitly trusted configuration; expected.json is never read.
        refs = json.loads(self.settings.procurement_path.read_text())
        refs['policy'] = refs.get('policy', refs.get('validation_policy', {}))
        if not refs['policy'].get('as_of_date'):
            from datetime import datetime, timezone
            refs['policy']['as_of_date'] = datetime.now(timezone.utc).date().isoformat()
        return refs

    def ingest(self, content, sender, filename, email_id=None, actor='api'):
        if not content or len(content) > self.settings.max_pdf_bytes:
            raise ValueError('PDF must contain 1 to 20 MiB of data.')
        digest = hashlib.sha256(content).hexdigest()
        with self.store.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            existing = c.execute('SELECT id FROM jobs WHERE hash=?', (digest,)).fetchone()
            duplicate = existing is not None
            job_id = existing['id'] if duplicate else str(uuid.uuid4())
            if not duplicate:
                timestamp = now()
                c.execute('''INSERT INTO jobs(id,email_id,hash,sender,filename,content,status,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,?,?)''', (job_id, email_id, digest, sender, filename, content, 'queued', timestamp, timestamp))
            c.execute('INSERT INTO submissions(job_id,email_id,sender,filename,created_at) VALUES(?,?,?,?,?)',
                      (job_id, email_id, sender, filename, now()))
            self.store.audit(c, job_id, 'duplicate_submission' if duplicate else 'ingested',
                             {'sha256': digest, 'email_id': email_id, 'sender': sender, 'filename': filename}, actor)
        return {'id': job_id, 'duplicate_submission': duplicate, 'status': self.store.get(job_id)['status']}

    def ingest_email(self, email_id, actor='api'):
        with sqlite3.connect(f'file:{self.settings.inbox_path}?mode=ro', uri=True) as c:
            c.row_factory = sqlite3.Row
            row = c.execute('SELECT * FROM emails WHERE id=?', (email_id,)).fetchone()
        if not row: raise NotFound('Email not found')
        from .settings import TEST_ROOT
        path = (TEST_ROOT / row['attachment_path']).resolve()
        if not path.is_relative_to(TEST_ROOT / 'test_inputs'):
            raise ValueError('Attachment path is outside the inbox.')
        if path.stat().st_size > self.settings.max_pdf_bytes:
            raise ValueError('Attachment exceeds size limit.')
        return self.ingest(path.read_bytes(), row['sender'], path.name, email_id, actor)

    def claim(self):
        with self.store.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
            if not row: return None
            c.execute("UPDATE jobs SET status='processing',updated_at=?,version=version+1 WHERE id=?", (now(), row['id']))
            self.store.audit(c, row['id'], 'processing_started', {})
            return row['id']

    def process_next(self):
        job_id = self.claim()
        if not job_id: return False
        try:
            with self.store.connect() as c:
                content = c.execute('SELECT content FROM jobs WHERE id=?', (job_id,)).fetchone()['content']
            pages = parse_pdf(content, self.settings)
            with self.store.connect() as c:
                c.execute('UPDATE jobs SET pages=?,model=? WHERE id=?', (dumps(pages), self.settings.model, job_id))
                self.store.audit(c, job_id, 'parsed', {'routes': [p['route'] for p in pages], 'prompt_version': PROMPT_VERSION})
            batch = self.extractor.extract(pages)
            with self.store.connect() as c:
                self.store.audit(c, job_id, 'extracted', batch.model_dump(mode='json'))
                c.execute('UPDATE jobs SET extraction=? WHERE id=?', (batch.model_dump_json(), job_id))
            if len(batch.documents) != 1:
                raise ProcessingError('MULTIPLE_DOCUMENTS', 'Bundled documents require separation and individual ingestion before approval.')
            self.validate(job_id, batch.documents[0])
        except ProcessingError as exc:
            self.fail(job_id, exc.code, exc.message)
        except Exception:
            log.exception('Processing failed for case %s', job_id)
            self.fail(job_id, 'PROCESSING_ERROR', 'Processing dependency failed. Inspect server logs, then retry after repair.')
        return True

    def fail(self, job_id, code, message):
        findings = [{'code': code, 'message': message, 'stage': 'processing', 'field': None}]
        decision = {'outcome': 'review', 'reason_codes': [code], 'explanation': message}
        with self.store.connect() as c:
            c.execute("UPDATE jobs SET status='review',findings=?,decision=?,updated_at=?,version=version+1 WHERE id=?",
                      (dumps(findings), dumps(decision), now(), job_id))
            self.store.audit(c, job_id, 'review_required', decision)

    def validate(self, job_id, extraction, actor='system', expected_version=None, note=None):
        refs = self.references()
        with self.store.connect() as c:
            # Serialize duplicate decisions and PO reservations in one DB transaction.
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row: raise NotFound('Case not found')
            if expected_version is not None:
                if row['status'] != 'review' or row['version'] != expected_version:
                    raise Conflict('Case changed or is not in review; reload before submitting.')
                prior = json.loads(row['extraction']) if row['extraction'] else None
                if prior and 'documents' in prior and len(prior['documents']) != 1:
                    raise Conflict('Separate bundled documents before correcting an individual invoice.')
            pages = json.loads(row['pages'] or '[]')
            if not pages:
                raise Conflict('No parsed source pages are available; repair the parsing dependency and retry processing.')
            # Review attests all submitted fields; business rules and formats always rerun.
            verified = set()
            if expected_version is not None:
                verified.update(extraction.__class__.model_fields)
                for i, line in enumerate(extraction.line_items):
                    verified.update(f'line_items.{i}.{name}' for name in line.__class__.model_fields)
            existing = [dict(r) for r in c.execute("""SELECT * FROM jobs WHERE id<>? AND vendor_id IS NOT NULL
                       AND (status='approved' OR (status IN ('review','duplicate') AND
                       (created_at < ? OR (created_at = ? AND id < ?))))""",
                       (job_id, row['created_at'], row['created_at'], job_id))]
            reservations = [dict(r) for r in c.execute('SELECT * FROM reservations WHERE job_id<>?', (job_id,))]
            result = evaluate(extraction, pages, refs, existing, reservations, self.settings, verified)
            findings, outcome = result['findings'], result['outcome']
            codes = sorted({f['code'] for f in findings})
            decision = {'outcome': outcome, 'reason_codes': codes,
                        'explanation': 'All configured validation and matching rules passed.' if not findings else '; '.join(f['message'] for f in findings)}
            po, vendor, values = result['po'], result['vendor'], result['values']
            if outcome == 'approved':
                if not po or result['converted'] is None: raise RuntimeError('Approval invariant violated')
                c.execute('INSERT INTO reservations(job_id,po_number,amount) VALUES(?,?,?)', (job_id, po['number'], str(result['converted'])))
            c.execute('''UPDATE jobs SET status=?, extraction=?, findings=?, checks=?, decision=?,po_number=?,vendor_id=?,
                      invoice_number=?,amount=?,currency=?,invoice_date=?,policy_snapshot=?,updated_at=?,version=version+1 WHERE id=?''',
                      (outcome, extraction.model_dump_json(), dumps(findings), dumps(result['checks']), dumps(decision),
                       po['number'] if po else None, vendor['id'] if vendor else None, values['invoice_number'],
                       str(values['total_amount']) if values['total_amount'] is not None else None, values['currency'], values['invoice_date'], dumps(refs), now(), job_id))
            if expected_version is not None:
                self.store.audit(c, job_id, 'human_correction', {'note': note, 'before': json.loads(row['extraction']) if row['extraction'] else None,
                                 'after': extraction.model_dump(mode='json'), 'reentry_stage': 'validation'}, actor)
            for stage in ('validation', 'vendor_check', 'duplicate_check', 'po_identification', 'po_matching'):
                stage_findings = [f for f in findings if f['stage'] == stage]
                self.store.audit(c, job_id, stage, {'passed': not stage_findings, 'findings': stage_findings}, actor)
            self.store.audit(c, job_id, 'decision', {'decision': decision, 'checks': result['checks'], 'policy': refs['policy']}, actor)
        return self.store.get(job_id)

    def retry(self, job_id, expected_version, note, actor):
        with self.store.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row: raise NotFound('Case not found')
            if row['status'] != 'review' or row['version'] != expected_version:
                raise Conflict('Case changed or is not in review.')
            decision = json.loads(row['decision']) if row['decision'] else {}
            allowed = {'OCR_UNAVAILABLE', 'OCR_FAILED', 'EXTRACTION_NOT_CONFIGURED', 'EXTRACTION_SCHEMA_FAILED', 'PROCESSING_ERROR'}
            if not set(decision.get('reason_codes', [])) & allowed:
                raise Conflict('Business exceptions require correction at validation, not re-extraction.')
            c.execute("UPDATE jobs SET status='queued',updated_at=?,version=version+1 WHERE id=?", (now(), job_id))
            self.store.audit(c, job_id, 'dependency_retry_requested', {'note': note}, actor)
        return self.store.get(job_id)

    def start(self):
        import fcntl
        self.worker_lock = open(str(self.settings.db_path) + '.worker.lock', 'a')
        try:
            fcntl.flock(self.worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.worker_lock.close()
            self.worker_lock = None
            raise RuntimeError('Only one worker process may own a processing database. Set WORKER_ENABLED=false on API-only replicas.')
        # An interrupted in-flight case is reviewed; it is never silently replayed.
        with self.store.connect() as c:
            ids = [r['id'] for r in c.execute("SELECT id FROM jobs WHERE status='processing'")]
        for job_id in ids: self.fail(job_id, 'PROCESSING_ERROR', 'Worker interrupted. Review or explicitly retry processing.')
        self.stop_event.clear()
        def work():
            while not self.stop_event.is_set():
                try:
                    if not self.process_next(): self.stop_event.wait(.5)
                except Exception:
                    log.exception('Worker loop error')
                    self.stop_event.wait(2)
        self.thread = threading.Thread(target=work, daemon=True, name='invoice-worker')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)
        if self.worker_lock and not (self.thread and self.thread.is_alive()):
            self.worker_lock.close()
            self.worker_lock = None
