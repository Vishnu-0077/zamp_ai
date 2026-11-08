"""Reset regressions; fixture sources under test_cases are read only."""
import json
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.processing_api import install
from backend.settings import Settings
from backend.invoice_service import Service
from test_cases.test_backend import BackendTests


class ResetTests(unittest.TestCase):
    def setUp(self):
        self.fixture = BackendTests()
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def test_api_reset_requires_reviewer_and_clears_all_processing_tables(self):
        f = self.fixture
        app = FastAPI()
        service = install(app, f.settings, f.service.extractor)
        before = f.settings.procurement_path.read_bytes()
        client = TestClient(app)
        job = service.ingest(b'example', '', 'source.pdf')['id']
        self.assertEqual(client.post('/api/v1/reset').status_code, 403)
        self.assertIsNotNone(service.store.get(job))
        response = client.post('/api/v1/reset', headers={'X-Reviewer-Key': 'review-secret'})
        self.assertEqual(response.status_code, 200)
        for table in ('jobs', 'submissions', 'audit', 'reservations'):
            with service.store.connect() as c:
                self.assertEqual(c.execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)
        self.assertEqual(f.settings.procurement_path.read_bytes(), before)
        refs = json.loads(before)
        refs['vendors'][0]['name'] = 'Reloaded vendor'
        f.settings.procurement_path.write_text(json.dumps(refs))
        self.assertEqual(client.get('/api/v1/references').json()['vendors'][0]['name'], 'Reloaded vendor')

    def test_restart_clears_by_default(self):
        f = self.fixture
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(Settings().reset_on_start)
        f.settings.reset_on_start = True
        job = f.service.ingest(b'example', '', 'source.pdf')['id']
        service = Service(f.settings)
        try:
            service.start()
            self.assertIsNone(service.store.get(job))
        finally:
            service.stop()

    def test_reset_waits_for_processing_before_removing_case(self):
        f = self.fixture
        entered, release, resetting = threading.Event(), threading.Event(), threading.Event()
        original = f.service.extractor.extract
        def extract(pages):
            entered.set()
            self.assertTrue(release.wait(5))
            return original(pages)
        f.service.extractor.extract = extract
        job = f.ingest()
        def reset():
            resetting.set()
            return f.service.reset()
        with ThreadPoolExecutor(max_workers=2) as pool:
            processing = pool.submit(f.service.process_next)
            self.assertTrue(entered.wait(5))
            clearing = pool.submit(reset)
            self.assertTrue(resetting.wait(5))
            self.assertFalse(clearing.done())
            release.set()
            self.assertTrue(processing.result(timeout=5))
            self.assertEqual(clearing.result(timeout=5), {'status': 'reset'})
        self.assertIsNone(f.service.store.get(job))
