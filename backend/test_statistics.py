"""Statistics: totals, per-vendor and per-problem aggregation."""
import json
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.processing_api import install
from backend.statistics import compute
from test_cases import test_backend as fixtures  # module import, so its tests are not collected twice

REFS = {'vendors': [{'id': 'V1', 'name': 'Acme'}, {'id': 'V2', 'name': 'Beta'}, {'id': 'V3', 'name': 'Clean Co'}]}


def case(status, vendor_id=None, codes=(), amount='100.00', currency='USD', manual=False, vendor_name=None, fields=None):
    findings = [{'code': c, 'message': c, 'stage': 'validation', 'field': (fields or {}).get(c)} for c in codes]
    decision = {'outcome': status, 'reason_codes': sorted(set(codes)), 'explanation': ''}
    if manual:
        decision['manual_override'] = True
    extraction = {'vendor_name': {'value': vendor_name}} if vendor_name else None
    return {'status': status, 'vendor_id': vendor_id, 'amount': amount, 'currency': currency,
            'findings': json.dumps(findings), 'decision': json.dumps(decision), 'extraction': json.dumps(extraction)}


class StatisticsTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            case('approved', 'V1'),
            case('review', 'V1', ['BANK_ACCOUNT_CHANGED', 'TOTAL_MISMATCH']),
            case('review', 'V1', ['BANK_ACCOUNT_CHANGED', 'BANK_ACCOUNT_CHANGED']),   # counted once per case
            case('approved', 'V2', ['TOTAL_MISMATCH'], amount='50.00', manual=True),
            case('duplicate', 'V2', ['DUPLICATE_INVOICE']),
            case('approved', 'V3', amount='20.00', currency='INR'),
            case('review', None, ['PROCESSING_ERROR']),                               # a system failure, not a vendor's
            case('review', None, ['UNAPPROVED_VENDOR'], vendor_name='Ghost Ltd'),
            case('queued', 'V3'),
        ]
        self.stats = compute(self.rows, REFS)
        self.vendors = {v['key']: v for v in self.stats['vendors']}
        self.problems = {p['code']: p for p in self.stats['problems']}

    def test_totals(self):
        t = self.stats['totals']
        self.assertEqual(t['cases'], 9)
        self.assertEqual(t['by_status'], {'queued': 1, 'processing': 0, 'review': 4, 'approved': 3, 'duplicate': 1})
        self.assertEqual(t['finished'], 8)
        self.assertEqual((t['approved_automatic'], t['approved_manual']), (2, 1))
        self.assertEqual(t['approval_rate'], 0.375)
        self.assertEqual(t['straight_through_rate'], 0.25)
        self.assertEqual(t['cases_with_problems'], 6)
        self.assertEqual(t['cases_with_invoice_problems'], 5)
        self.assertEqual(t['cases_with_processing_problems'], 1)
        self.assertEqual(t['approved_value'], [{'currency': 'INR', 'amount': '20.00'}, {'currency': 'USD', 'amount': '150.00'}])
        self.assertEqual(t['held_value'], [{'currency': 'USD', 'amount': '400.00'}])

    def test_vendor_breakdown_and_top_problem(self):
        acme = self.vendors['V1']
        self.assertEqual((acme['cases'], acme['approved'], acme['review'], acme['problem_cases']), (3, 1, 2, 2))
        self.assertAlmostEqual(acme['problem_rate'], 0.6667)
        self.assertEqual(acme['top_problems'], ['BANK_ACCOUNT_CHANGED'])
        self.assertEqual(acme['top_problem_cases'], 2)
        self.assertEqual(acme['problems'], [{'code': 'BANK_ACCOUNT_CHANGED', 'cases': 2}, {'code': 'TOTAL_MISMATCH', 'cases': 1}])
        beta = self.vendors['V2']
        self.assertEqual(beta['approved_manual'], 1)
        self.assertEqual(beta['top_problems'], ['DUPLICATE_INVOICE', 'TOTAL_MISMATCH'])  # a tie keeps both
        clean = self.vendors['V3']
        self.assertEqual((clean['problem_cases'], clean['top_problems'], clean['in_progress']), (0, [], 1))

    def test_vendors_not_in_master_and_processing_failures(self):
        ghost = self.vendors['name:ghost ltd']
        self.assertEqual((ghost['name'], ghost['in_master'], ghost['problem_cases']), ('Ghost Ltd', False, 1))
        unknown = self.vendors['unidentified']
        self.assertEqual(unknown['problem_cases'], 0)           # processing errors never count against a vendor
        self.assertEqual(unknown['top_problems'], [])
        self.assertEqual(self.problems['PROCESSING_ERROR']['category'], 'processing')

    def test_ranking_and_highlights(self):
        # Both have 2 problem cases; Beta's rate is higher (2 of 2 against 2 of 3), so it ranks first.
        self.assertEqual([v['key'] for v in self.stats['vendors']][:2], ['V2', 'V1'])
        self.assertEqual(self.stats['highlights']['most_problematic_vendors'], ['V2'])
        # BANK_ACCOUNT_CHANGED and TOTAL_MISMATCH both affect 2 cases.
        self.assertEqual(self.stats['highlights']['most_common_problems'], ['BANK_ACCOUNT_CHANGED', 'TOTAL_MISMATCH'])
        self.assertEqual([p['code'] for p in self.stats['problems']][-1], 'PROCESSING_ERROR')  # processing problems listed last
        total = self.problems['TOTAL_MISMATCH']
        self.assertEqual(total['vendors'], [{'key': 'V1', 'name': 'Acme', 'cases': 1}, {'key': 'V2', 'name': 'Beta', 'cases': 1}])
        self.assertEqual(total['share_of_cases'], round(2 / 9, 4))

    def test_fields_are_counted_per_problem(self):
        stats = compute([case('review', 'V1', ['EVIDENCE_NOT_FOUND'], fields={'EVIDENCE_NOT_FOUND': 'total_amount'})], REFS)
        self.assertEqual(stats['problems'][0]['fields'], [{'field': 'total_amount', 'cases': 1}])

    def test_empty(self):
        stats = compute([], REFS)
        self.assertEqual(stats['totals']['cases'], 0)
        self.assertIsNone(stats['totals']['approval_rate'])
        self.assertEqual(stats['highlights'], {'most_problematic_vendors': [], 'most_common_problems': []})

    def test_api_returns_statistics_for_real_cases(self):
        f = fixtures.BackendTests()
        f.setUp()
        try:
            f.settings.api_key = 'app-secret'
            app = FastAPI()
            service = install(app, f.settings, f.service.extractor)
            client = TestClient(app)
            f.service = service
            f.ingest()
            service.process_next()
            self.assertEqual(client.get('/api/v1/statistics').status_code, 401)
            body = client.get('/api/v1/statistics', headers={'X-API-Key': 'app-secret'}).json()
            self.assertEqual(body['totals']['by_status']['approved'], 1)
            self.assertEqual(body['vendors'][0]['name'], 'Test Vendor')
        finally:
            f.tearDown()


if __name__ == '__main__':
    unittest.main()
