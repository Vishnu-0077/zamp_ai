import unittest
from backend.invoice_extractor import parse_pdf
from test_cases.test_backend import BackendTests, pdf


class AuditFixTests(unittest.TestCase):
    def setUp(self):
        self.fixture = BackendTests()
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def test_spacing_differences_do_not_reject_real_evidence(self):
        f = self.fixture
        job = f.seeded()
        e = f.e.model_copy(deep=True)
        e.vendor_name.evidence = 'Test   Vendor'
        self.assertEqual(f.service.validate(job, e)['status'], 'approved')

    def test_changed_evidence_is_still_rejected(self):
        f = self.fixture
        job = f.seeded()
        e = f.e.model_copy(deep=True)
        e.vendor_name.evidence = 'Test Other Vendor'
        self.assertIn('EVIDENCE_NOT_FOUND', f.codes(f.service.validate(job, e)))

    def test_distant_header_columns_are_not_concatenated(self):
        import pymupdf
        with pymupdf.open() as doc:
            page = doc.new_page()
            page.insert_text((40, 40), 'HARBOR', fontsize=28)
            page.insert_text((40, 60), 'IT SERVICES / MANAGED SOLUTIONS')
            page.insert_text((450, 40), 'INVOICE', fontsize=24)
            pages = parse_pdf(doc.tobytes(), self.fixture.settings)
        self.assertIn('HARBOR\n', pages[0]['text'])
        self.assertNotIn('INVOICEHARBOR', pages[0]['text'])

    def test_only_trusted_unambiguous_aliases_match(self):
        import json
        f = self.fixture
        f.refs['vendors'][0]['aliases'] = ['Test Trading']
        f.settings.procurement_path.write_text(json.dumps(f.refs))
        e = f.e.model_copy(deep=True)
        e.vendor_name.value = e.vendor_name.evidence = 'Test Trading'
        job = f.seeded(e)
        self.assertEqual(f.service.validate(job, e)['status'], 'approved')
        f.refs['vendors'].append(dict(f.refs['vendors'][0], id='V2'))
        f.settings.procurement_path.write_text(json.dumps(f.refs))
        job = f.seeded(e.model_copy(update={'invoice_number': e.invoice_number.model_copy(update={'value': 'OTHER', 'evidence': 'OTHER'})}))
        self.assertIn('UNAPPROVED_VENDOR', f.codes(f.service.validate(job, e)))

    def test_punctuation_difference_requires_review_not_exact_duplicate(self):
        f = self.fixture
        first = f.seeded()
        f.service.validate(first, f.e)
        e = f.e.model_copy(deep=True)
        e.invoice_number.value = e.invoice_number.evidence = 'INV001'
        second = f.seeded(e)
        result = f.service.validate(second, e)
        self.assertEqual(result['status'], 'review')
        self.assertIn('POSSIBLE_DUPLICATE', f.codes(result))
        self.assertNotIn('DUPLICATE_INVOICE', f.codes(result))

    def test_inbox_counts_include_identical_email_duplicates(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from backend.processing_api import install
        f = self.fixture
        app = FastAPI()
        service = install(app, f.settings, f.service.extractor)
        source = pdf('Same invoice source')
        service.ingest(source, '', 'invoice.pdf', email_id=1)
        service.ingest(source, '', 'followup.pdf', email_id=41)
        service.ingest(source, '', 'repeat-click.pdf', email_id=41)
        with TestClient(app) as client:
            stats = client.get('/api/v1/stats').json()
        self.assertEqual(stats['counts'], {'queued': 1})
        self.assertEqual(stats['inbox_counts'], {'queued': 1, 'duplicate': 1})

    def test_evidence_retry_uses_source_and_remains_bounded(self):
        from unittest.mock import patch
        from backend.invoice_extractor import LangChainExtractor
        from backend.schemas import ExtractionBatch
        from test_cases.test_backend import text_for
        f = self.fixture
        extractor = LangChainExtractor(f.settings)
        batch = ExtractionBatch(documents=[f.e])
        pages = [{'page': 1, 'text': text_for(f.e)}]
        with patch.object(extractor, 'extract') as retry:
            self.assertIs(extractor.repair_evidence(batch, pages), batch)
            retry.assert_not_called()
        bad = batch.model_copy(deep=True)
        bad.documents[0].total_amount.evidence = 'invented quotation'
        with patch.object(extractor, 'extract', return_value=batch) as retry:
            repaired = extractor.repair_evidence(bad, pages)
            retry.assert_called_once()
            self.assertIs(repaired, batch)
            self.assertIn('total_amount', retry.call_args.kwargs['feedback'])
            self.assertEqual(retry.call_args.args[0], pages)

    def test_full_page_scan_keeps_native_pixels(self):
        import io
        import subprocess
        from unittest.mock import patch
        import pymupdf
        from PIL import Image
        source = io.BytesIO()
        Image.new('RGB', (600, 800), 'white').save(source, format='PNG')
        with pymupdf.open() as doc:
            page = doc.new_page(width=300, height=400)
            page.insert_image(page.rect, stream=source.getvalue())
            content = doc.tobytes()
        def ocr(args, **kwargs):
            pix = pymupdf.Pixmap(args[1])
            self.assertEqual((pix.width, pix.height), (600, 800))
            return subprocess.CompletedProcess(args, 0, 'block_num\tpar_num\tline_num\tconf\ttext\n1\t1\t1\t95\t11\n')
        with patch('backend.invoice_extractor.shutil.which', return_value='/usr/bin/tesseract'), patch('backend.invoice_extractor.subprocess.run', side_effect=ocr):
            pages = parse_pdf(content, self.fixture.settings)
        self.assertEqual(pages[0]['text'], '11')
