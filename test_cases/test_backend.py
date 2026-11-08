import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import pymupdf as fitz
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.processing_api import install
from backend.settings import Settings
from backend.schemas import InvoiceExtraction, ExtractionBatch
from backend.invoice_service import Service, Conflict
from backend.database import dumps
from backend.invoice_extractor import LangChainExtractor, ProcessingError


def field(value, evidence=None):
    return {'value': value, 'confidence': 'high' if value is not None else 'low',
            'evidence': evidence if evidence is not None else str(value) if value is not None else None,
            'page': 1 if value is not None else None}


def extraction(number='INV-001', total='110'):
    data = {k: field(None) for k in InvoiceExtraction.model_fields if k != 'line_items'}
    for k, v in {'document_type': 'INVOICE', 'vendor_name': 'Test Vendor', 'invoice_number': number,
                 'invoice_date': '2026-10-01', 'due_date': '2026-11-01', 'currency': 'USD', 'po_reference': 'PO-1',
                 'subtotal': '100', 'tax': '10', 'total_amount': total, 'bank_details': 'ACCOUNT-1'}.items():
        data[k] = field(v)
    data['line_items'] = [{k: field(v) for k,v in {'description': 'Work', 'quantity': '1', 'unit_price': '100', 'amount': '100'}.items()}]
    return InvoiceExtraction.model_validate(data)


def text_for(e):
    fields = [v for v in e.__dict__.values() if hasattr(v, 'evidence')]
    fields += [v for line in e.line_items for v in line.__dict__.values()]
    return '\n'.join(str(f.evidence) for f in fields if f.evidence)


def pdf(text):
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((40, 40), text)
        return doc.tobytes()


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.refs = {'vendors': [{'id': 'V1', 'name': 'Test Vendor', 'approved': True, 'bank_account': 'ACCOUNT-1'}],
                     'purchase_orders': [{'number': 'PO-1', 'vendor_id': 'V1', 'amount': '110', 'received_amount': '110', 'currency': 'USD', 'issue_date': '2026-09-01'}],
                     'fx_rates': [], 'policy': {'as_of_date': '2026-11-02', 'amount_tolerance': '.01'}}
        (root / 'refs.json').write_text(json.dumps(self.refs))
        self.settings = Settings(db_path=root / 'db.sqlite3', procurement_path=root / 'refs.json', worker_enabled=False)
        self.e = extraction()
        class FakeExtractor:
            def extract(inner, pages): return ExtractionBatch(documents=[self.e])
        self.service = Service(self.settings, FakeExtractor())

    def tearDown(self): self.temp.cleanup()

    def ingest(self, e=None):
        e = e or self.e
        return self.service.ingest(pdf(text_for(e)), 'billing@test.invalid', 'invoice.pdf')['id']

    def seeded(self, e=None):
        e = e or self.e
        job_id = self.ingest(e)
        with self.service.store.connect() as c:
            c.execute("UPDATE jobs SET status='review',pages=?,extraction=? WHERE id=?", (dumps([{'page':1, 'text':text_for(e), 'route':'digital', 'ocr_confidence':None}]), e.model_dump_json(), job_id))
        return job_id

    def codes(self, result): return {f['code'] for f in result['findings']}

    def test_end_to_end_and_hash_idempotence(self):
        job_id = self.ingest()
        self.assertTrue(self.service.process_next())
        self.assertEqual(self.service.store.get(job_id)['status'], 'approved')
        # PDF timestamps/object IDs may vary; reuse exact persisted bytes instead.
        with self.service.store.connect() as c:
            content = c.execute('SELECT content FROM jobs WHERE id=?', (job_id,)).fetchone()[0]
        self.assertEqual(self.service.ingest(content, '', 'again.pdf')['id'], job_id)
        with self.service.store.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM reservations').fetchone()[0], 1)

    def test_reset_on_start_clears_cases_only_when_enabled(self):
        self.ingest()
        self.assertTrue(self.service.process_next())
        def count(service, table):
            with service.store.connect() as c: return c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        self.settings.reset_on_start = False
        kept = Service(self.settings, None)
        kept.start(); kept.stop()
        self.assertEqual(count(kept, 'jobs'), 1)
        self.assertEqual(count(kept, 'reservations'), 1)
        self.settings.reset_on_start = True
        fresh = Service(self.settings, None)
        fresh.start(); fresh.stop()
        for table in ('jobs', 'submissions', 'audit', 'reservations'):
            self.assertEqual(count(fresh, table), 0, table)
        # The same invoice is processed again instead of being treated as a duplicate.
        self.ingest()
        self.assertTrue(self.service.process_next())
        self.assertEqual(count(fresh, 'reservations'), 1)

    def test_evidence_hallucination_blocks_approval(self):
        e = self.e.model_copy(deep=True)
        e.total_amount.evidence = 'made up'
        result = self.service.validate(self.seeded(), e)
        self.assertEqual(result['status'], 'review')
        self.assertIn('EVIDENCE_NOT_FOUND', self.codes(result))

    def test_evidence_value_mismatch(self):
        e = self.e.model_copy(deep=True)
        e.total_amount.evidence = '100'
        result = self.service.validate(self.seeded(e), e)
        self.assertIn('VALUE_NOT_SUPPORTED', self.codes(result))

    def test_missing_field_and_format(self):
        e = self.e.model_copy(deep=True)
        e.invoice_number.value = None
        e.invoice_date.value = '2026-99-40'
        result = self.service.validate(self.seeded(e), e)
        self.assertIn('MISSING_INVOICE_NUMBER', self.codes(result))
        self.assertIn('INVALID_DATE', self.codes(result))

    def test_review_does_not_bypass_math_or_bank(self):
        e = extraction(total='120')
        e.bank_details.value = 'ATTACKER'
        job_id = self.seeded(e)
        result = self.service.validate(job_id, e, 'reviewer', 1, 'Verified source document')
        self.assertEqual(result['status'], 'review')
        self.assertIn('TOTAL_MISMATCH', self.codes(result))
        self.assertIn('BANK_ACCOUNT_CHANGED', self.codes(result))

    def test_manual_approval_requires_acknowledging_every_issue_and_reserves_po(self):
        e = self.e.model_copy(deep=True)
        e.bank_details.value = 'ATTACKER'
        job_id = self.seeded(e)
        held = self.service.validate(job_id, e)
        self.assertEqual(held['status'], 'review')
        codes = held['decision']['reason_codes']
        self.assertIn('BANK_ACCOUNT_CHANGED', codes)
        with self.assertRaises(Conflict):
            self.service.approve_manually(job_id, held['version'], 'Called vendor on file', [], 'reviewer')
        approved = self.service.approve_manually(job_id, held['version'], 'Called vendor on file to confirm', codes, 'reviewer')
        self.assertEqual(approved['status'], 'approved')
        self.assertTrue(approved['decision']['manual_override'])
        self.assertEqual(approved['decision']['reason_codes'], sorted(codes))
        self.assertEqual(approved['findings'], held['findings'])
        with self.service.store.connect() as c:
            self.assertEqual(c.execute('SELECT po_number FROM reservations WHERE job_id=?', (job_id,)).fetchone()[0], 'PO-1')
            events = [r[0] for r in c.execute('SELECT event FROM audit WHERE job_id=?', (job_id,))]
        self.assertIn('manual_approval', events)
        with self.assertRaises(Conflict):  # no longer in review / stale version
            self.service.approve_manually(job_id, approved['version'], 'Called vendor on file to confirm', codes, 'reviewer')

    def test_approved_invoices_excel_is_kept_current(self):
        from io import BytesIO
        from openpyxl import load_workbook
        path = self.settings.export_path
        self.assertTrue(path.is_relative_to(Path(self.temp.name)))  # never the real runtime folder
        auto = self.seeded()
        self.service.validate(auto, self.e)
        held_e = extraction(number='INV-002')
        held_e.bank_details.value = 'ATTACKER'
        held = self.seeded(held_e)
        case = self.service.validate(held, held_e)
        self.service.approve_manually(held, case['version'], 'Vendor confirmed new account by phone', case['decision']['reason_codes'], 'reviewer:abc')
        book = load_workbook(path)
        self.assertEqual(book.sheetnames, ['Summary', 'Approved invoices', 'Line items'])
        rows = list(book['Approved invoices'].iter_rows(values_only=True))
        header = rows[0]
        records = [dict(zip(header, r)) for r in rows[1:]]
        self.assertEqual([r['Invoice number'] for r in records], ['INV-001', 'INV-002'])
        self.assertEqual([r['Approval'] for r in records], ['Automatic', 'Manual'])
        self.assertEqual(records[1]['Approved by'], 'reviewer:abc')
        self.assertEqual(records[1]['Reviewer note'], 'Vendor confirmed new account by phone')
        self.assertIn('BANK_ACCOUNT_CHANGED', records[1]['Overridden issues'])
        self.assertEqual(float(records[0]['Total']), 110.0)
        self.assertEqual((records[1]['Bank account on vendor record'], records[1]['Bank account on invoice']), ('ACCOUNT-1', 'ATTACKER'))
        self.assertEqual(len(list(book['Line items'].iter_rows(values_only=True))), 3)
        # The API download is generated from the same data.
        app = FastAPI()
        install(app, self.settings)
        with TestClient(app) as client:
            response = client.get('/api/v1/exports/approved-invoices.xlsx')
        self.assertEqual(response.status_code, 200)
        self.assertIn('attachment; filename="approved-invoices-', response.headers['content-disposition'])
        self.assertEqual(load_workbook(BytesIO(response.content))['Summary']['B3'].value, 2)
        # A reset empties the register.
        self.service.reset()
        self.assertEqual(load_workbook(path)['Approved invoices'].max_row, 1)

    def test_manual_approval_refused_when_nothing_was_read(self):
        job_id = self.ingest()
        self.service.fail(job_id, 'PROCESSING_ERROR', 'Provider down')
        case = self.service.store.get(job_id)
        with self.assertRaises(Conflict):
            self.service.approve_manually(job_id, case['version'], 'Looks fine to me honestly', ['PROCESSING_ERROR'], 'reviewer')

    def test_manual_approval_api_needs_no_key_and_records_the_reviewer_name(self):
        app = FastAPI()
        install(app, self.settings)
        e = self.e.model_copy(deep=True)
        e.bank_details.value = 'ATTACKER'
        job_id = self.seeded(e)
        held = self.service.validate(job_id, e)
        with TestClient(app) as client:
            body = {'expected_version': held['version'], 'note': 'Checked against the PDF',
                    'acknowledged_codes': held['decision']['reason_codes']}
            self.assertEqual(client.post(f'/api/v1/cases/{job_id}/approve', json=body).status_code, 422)  # name required
            response = client.post(f'/api/v1/cases/{job_id}/approve', json={**body, 'reviewer': '  Priya   S '})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn('ReviewerKey', str(client.get('/openapi.json').json()))
        with self.service.store.connect() as c:
            actor = c.execute("SELECT actor FROM audit WHERE job_id=? AND event='manual_approval'", (job_id,)).fetchone()[0]
        self.assertEqual(actor, 'reviewer:Priya S')

    def test_correction_reenters_validation_and_stale_write_rejected(self):
        e = self.e.model_copy(deep=True)
        e.invoice_date.value = None
        job_id = self.seeded(e)
        with patch('backend.invoice_service.parse_pdf', side_effect=AssertionError('OCR must not run')):
            result = self.service.validate(job_id, self.e, 'reviewer', 1, 'Date visually verified')
        self.assertEqual(result['status'], 'approved')
        with self.assertRaises(Conflict): self.service.validate(job_id, self.e, 'reviewer', 1, 'Old submission')

    def test_concurrent_po_reservations(self):
        a, b = self.seeded(), self.seeded(extraction('B-999'))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda pair: self.service.validate(*pair), [(a,self.e),(b,extraction('B-999'))]))
        self.assertEqual(sorted(r['status'] for r in results), ['approved', 'review'])
        review = next(r for r in results if r['status'] == 'review')
        self.assertIn('PO_BALANCE_EXCEEDED', self.codes(review))

    def test_exact_invoice_duplicate(self):
        first = self.seeded()
        self.service.validate(first, self.e)
        e = extraction()
        second = self.service.ingest(pdf('Different scan\n' + text_for(e)), '', 'scan.pdf')['id']
        with self.service.store.connect() as c:
            c.execute('UPDATE jobs SET pages=? WHERE id=?', (dumps([{'page':1,'text':text_for(e),'route':'digital','ocr_confidence':None}]),second))
        result = self.service.validate(second, e)
        self.assertEqual(result['status'], 'duplicate')

    def test_missing_extractor_fails_closed(self):
        self.service.extractor = LangChainExtractor(self.settings)
        job_id = self.ingest()
        self.service.process_next()
        result = self.service.store.get(job_id)
        self.assertEqual(result['status'], 'review')
        self.assertIn('EXTRACTION_NOT_CONFIGURED', self.codes(result))

    def test_bundled_documents_never_approved(self):
        class Bundled:
            def extract(inner, pages): return ExtractionBatch(documents=[self.e,self.e])
        self.service.extractor = Bundled()
        job_id = self.ingest()
        self.service.process_next()
        self.assertIn('MULTIPLE_DOCUMENTS', self.codes(self.service.store.get(job_id)))
        with self.assertRaises(Conflict): self.service.validate(job_id, self.e, 'reviewer', self.service.store.get(job_id)['version'], 'Please approve bundle')

    def test_low_ocr_confidence(self):
        job_id = self.seeded()
        with self.service.store.connect() as c:
            c.execute('UPDATE jobs SET pages=? WHERE id=?', (dumps([{'page':1,'text':text_for(self.e),'route':'ocr','ocr_confidence':30}]),job_id))
        result = self.service.validate(job_id, self.e)
        self.assertIn('LOW_OCR_CONFIDENCE', self.codes(result))

    def test_api_auth_pagination_correction_and_openapi(self):
        self.settings.api_key = 'api-secret'
        app = FastAPI()
        service = install(app, self.settings)
        job_id = self.seeded()
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/v1/cases').status_code, 401)
            self.assertEqual(client.get('/api/v1/cases/').status_code, 401)
            self.assertEqual(client.get('/health').status_code, 200)
            self.assertEqual(client.get('/health/').status_code, 200)
            headers = {'X-API-Key':'api-secret'}
            self.assertEqual(client.get('/api/v1/cases?limit=0', headers=headers).status_code, 422)
            response = client.get('/api/v1/cases', headers=headers)
            self.assertEqual(response.json()['total'], 1)
            body = {'expected_version':1,'note':'All fields visually verified','extraction':self.e.model_dump(mode='json')}
            self.assertEqual(client.post(f'/api/v1/cases/{job_id}/corrections',json=body,headers=headers).status_code,422)
            body['reviewer'] = 'Sam'
            response = client.post(f'/api/v1/cases/{job_id}/corrections',json=body,headers=headers)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['status'],'approved')
            self.assertEqual(client.post(f'/api/v1/cases/{job_id}/corrections',json=body,headers=headers).status_code,409)
            self.assertEqual(client.get('/openapi.json', headers=headers).status_code,200)



    def test_missing_ocr_routes_to_review(self):
        with fitz.open() as doc:
            doc.new_page()
            content = doc.tobytes()
        job_id = self.service.ingest(content, '', 'scan.pdf')['id']
        with patch('backend.invoice_extractor.shutil.which', return_value=None):
            self.service.process_next()
        result = self.service.store.get(job_id)
        self.assertEqual(result['status'], 'review')
        self.assertIn('OCR_UNAVAILABLE', self.codes(result))

    def test_ocr_route_preserves_page_confidence(self):
        from backend.invoice_extractor import parse_pdf
        from unittest.mock import Mock
        with fitz.open() as doc:
            doc.new_page()
            content = doc.tobytes()
        output = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tconf\ttext\n5\t1\t1\t1\t1\t1\t93.5\tInvoice\n5\t1\t1\t1\t1\t2\t90.5\tINV-1\n'
        with patch('backend.invoice_extractor.shutil.which', return_value='/usr/bin/tesseract'), patch('backend.invoice_extractor.subprocess.run', return_value=Mock(stdout=output)):
            pages = parse_pdf(content, self.settings)
        self.assertEqual(pages[0]['route'],'ocr')
        self.assertEqual(pages[0]['text'],'Invoice INV-1')
        self.assertEqual(pages[0]['ocr_confidence'],92)

    def test_dependency_retry_is_explicit_and_business_retry_blocked(self):
        job_id = self.seeded()
        self.service.validate(job_id, self.e.model_copy(update={'invoice_number': self.e.invoice_number.model_copy(update={'value':None})}))
        version = self.service.store.get(job_id)['version']
        with self.assertRaises(Conflict): self.service.retry(job_id,version,'Try again please','reviewer')
        self.service.fail(job_id,'OCR_UNAVAILABLE','Install OCR')
        version = self.service.store.get(job_id)['version']
        result = self.service.retry(job_id,version,'OCR installed now','reviewer')
        self.assertEqual(result['status'],'queued')

    def test_fuzzy_duplicate_stays_in_review(self):
        first = self.seeded()
        self.service.validate(first,self.e)
        e = extraction('INV-002')
        second = self.seeded(e)
        result = self.service.validate(second,e)
        self.assertIn('POSSIBLE_DUPLICATE',self.codes(result))
        self.assertEqual(result['status'],'review')

class LangChainContractTests(unittest.TestCase):
    def test_structured_output_schema_retry_once_and_temperature(self):
        from unittest.mock import Mock
        from backend.invoice_extractor import LangChainExtractor
        settings = Settings(model='test-model')
        batch = ExtractionBatch(documents=[extraction()])
        structured = Mock()
        structured.invoke.side_effect = [{'parsed':None, 'parsing_error':ValueError('invalid')}, {'parsed':batch, 'parsing_error':None}]
        model = Mock()
        model.with_structured_output.return_value = structured
        with patch('langchain_openai.ChatOpenAI', return_value=model) as chat:
            result = LangChainExtractor(settings).extract([{'page':1, 'text':'source'}])
        self.assertEqual(len(result.documents),1)
        self.assertEqual(structured.invoke.call_count,2)
        self.assertEqual(chat.call_args.kwargs['temperature'],0)
        self.assertEqual(chat.call_args.kwargs['max_retries'],0)
        model.with_structured_output.assert_called_once_with(ExtractionBatch,method='json_schema',strict=True,include_raw=True)

    def test_two_invalid_outputs_become_reviewable_error(self):
        from unittest.mock import Mock
        structured = Mock()
        structured.invoke.return_value = {'parsed':None,'parsing_error':ValueError('invalid')}
        model = Mock()
        model.with_structured_output.return_value = structured
        with patch('langchain_openai.ChatOpenAI', return_value=model):
            with self.assertRaises(ProcessingError) as error:
                LangChainExtractor(Settings(model='test-model')).extract([{'page':1,'text':'source'}])
        self.assertEqual(error.exception.code,'EXTRACTION_SCHEMA_FAILED')
        self.assertEqual(structured.invoke.call_count,2)


def api_error(status, headers=None, body=None):
    import httpx, openai
    response = httpx.Response(status, headers=headers or {}, request=httpx.Request('POST', 'https://provider.invalid/chat/completions'))
    cls = {400: openai.BadRequestError, 413: openai.APIStatusError, 429: openai.RateLimitError, 503: openai.InternalServerError}[status]
    return cls('provider error', response=response, body=body)


class ProviderRetryTests(unittest.TestCase):
    """Transient provider errors are retried with backoff, then fall back to other models."""

    def run_extract(self, settings, outcomes):
        from unittest.mock import Mock
        structured = {}
        for name, effects in outcomes.items():
            s = Mock()
            s.invoke.side_effect = effects
            structured[name] = s
        def chat(**kwargs):
            model = Mock()
            model.with_structured_output.return_value = structured[kwargs['model']]
            return model
        sleeps = []
        extractor = LangChainExtractor(settings, sleep=sleeps.append)
        with patch('langchain_openai.ChatOpenAI', side_effect=chat):
            try:
                return extractor.extract([{'page':1,'text':'source'}]), extractor, structured, sleeps
            except Exception as exc:
                return exc, extractor, structured, sleeps

    def ok(self):
        return {'parsed': ExtractionBatch(documents=[extraction()]), 'parsing_error': None}

    def test_default_makes_a_single_attempt(self):
        result, _, structured, sleeps = self.run_extract(Settings(model='m1'), {'m1': [api_error(503), self.ok()]})
        self.assertEqual(getattr(result, 'status_code', None), 503)
        self.assertEqual(structured['m1'].invoke.call_count, 1)
        self.assertEqual(sleeps, [])

    def test_transient_error_is_retried_with_exponential_backoff(self):
        settings = Settings(model='m1', provider_retries=2, retry_backoff_seconds=1.5)
        result, extractor, structured, sleeps = self.run_extract(settings, {'m1': [api_error(503), api_error(429), self.ok()]})
        self.assertEqual(len(result.documents), 1)
        self.assertEqual(structured['m1'].invoke.call_count, 3)
        self.assertEqual(sleeps, [1.5, 3.0])
        self.assertEqual(extractor.last_model, 'm1')

    def test_retry_after_header_is_respected(self):
        settings = Settings(model='m1', provider_retries=1, retry_backoff_seconds=1)
        _, _, _, sleeps = self.run_extract(settings, {'m1': [api_error(429, {'retry-after': '7'}), self.ok()]})
        self.assertEqual(sleeps, [7.0])

    def test_long_retry_delay_skips_to_next_model(self):
        # Google free tier: daily quota exhausted, retryDelay of hours.
        quota = api_error(429, body=[{'error': {'code': 429, 'details': [{'retryDelay': '40134s'}]}}])
        settings = Settings(model='m1', fallback_models=['m2'], provider_retries=3, retry_backoff_seconds=5)
        result, extractor, structured, sleeps = self.run_extract(settings, {'m1': [quota], 'm2': [self.ok()]})
        self.assertEqual(len(result.documents), 1)
        self.assertEqual(structured['m1'].invoke.call_count, 1)
        self.assertEqual(sleeps, [])
        self.assertEqual(extractor.last_model, 'm2')

    def test_provider_prefix_routes_to_that_provider(self):
        settings = Settings(model='gemini:g1', fallback_models=['groq:openai/gpt-oss-120b'], provider_retries=0,
                            provider_keys={'gemini': 'gk', 'groq': 'qk'})
        calls = []
        def chat(**kwargs):
            from unittest.mock import Mock
            calls.append(kwargs)
            s = Mock()
            s.invoke.side_effect = [api_error(503)] if kwargs['model'] == 'g1' else [self.ok()]
            model = Mock(); model.with_structured_output.return_value = s
            return model
        extractor = LangChainExtractor(settings, sleep=lambda _: None)
        with patch('langchain_openai.ChatOpenAI', side_effect=chat):
            self.assertEqual(len(extractor.extract([{'page':1,'text':'source'}]).documents), 1)
        self.assertEqual([(c['model'], c['base_url'], c['api_key']) for c in calls],
                         [('g1', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'gk'),
                          ('openai/gpt-oss-120b', 'https://api.groq.com/openai/v1', 'qk')])
        self.assertEqual(extractor.last_model, 'groq:openai/gpt-oss-120b')

    def test_request_too_large_moves_to_next_model(self):
        settings = Settings(model='m1', fallback_models=['m2'], provider_retries=3)
        result, extractor, structured, sleeps = self.run_extract(settings, {'m1': [api_error(413)], 'm2': [self.ok()]})
        self.assertEqual(len(result.documents), 1)
        self.assertEqual(structured['m1'].invoke.call_count, 1)
        self.assertEqual(sleeps, [])
        self.assertEqual(extractor.last_model, 'm2')

    def test_provider_without_key_is_skipped(self):
        settings = Settings(model='groq:m1', fallback_models=['m2'], provider_keys={'groq': ''})
        result, extractor, structured, _ = self.run_extract(settings, {'m2': [self.ok()]})
        self.assertEqual(len(result.documents), 1)
        self.assertEqual(extractor.last_model, 'm2')
        only = Settings(model='groq:m1', provider_keys={'groq': ''})
        result, *_ = self.run_extract(only, {})
        self.assertEqual(result.code, 'EXTRACTION_NOT_CONFIGURED')

    def test_short_retry_delay_in_body_is_respected(self):
        limited = api_error(429, body={'error': {'details': [{'retryDelay': '12s'}]}})
        settings = Settings(model='m1', provider_retries=1, retry_backoff_seconds=5)
        _, _, _, sleeps = self.run_extract(settings, {'m1': [limited, self.ok()]})
        self.assertEqual(sleeps, [12.0])

    def test_falls_back_to_next_model_after_retries(self):
        settings = Settings(model='m1', fallback_models=['m2'], provider_retries=1, retry_backoff_seconds=0)
        result, extractor, structured, _ = self.run_extract(settings, {'m1': [api_error(503), api_error(503)], 'm2': [self.ok()]})
        self.assertEqual(len(result.documents), 1)
        self.assertEqual(structured['m1'].invoke.call_count, 2)
        self.assertEqual(extractor.last_model, 'm2')

    def test_non_transient_errors_are_not_retried(self):
        settings = Settings(model='m1', fallback_models=['m2'], provider_retries=3)
        result, _, structured, sleeps = self.run_extract(settings, {'m1': [api_error(400)], 'm2': [self.ok()]})
        self.assertEqual(getattr(result, 'status_code', None), 400)
        self.assertEqual(structured['m1'].invoke.call_count, 1)
        self.assertEqual(structured['m2'].invoke.call_count, 0)
        self.assertEqual(sleeps, [])

    def test_schema_failure_does_not_fall_back(self):
        settings = Settings(model='m1', fallback_models=['m2'], provider_retries=2)
        bad = {'parsed': None, 'parsing_error': ValueError('invalid')}
        result, _, structured, _ = self.run_extract(settings, {'m1': [bad, bad], 'm2': [self.ok()]})
        self.assertIsInstance(result, ProcessingError)
        self.assertEqual(result.code, 'EXTRACTION_SCHEMA_FAILED')
        self.assertEqual(structured['m2'].invoke.call_count, 0)

if __name__ == '__main__': unittest.main()
