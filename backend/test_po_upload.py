"""Purchase orders added from the dashboard (form and CSV). Fixtures under test_cases are read only."""
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.processing_api import install
from test_cases import test_backend as fixtures  # module import, so its tests are not collected twice

KEY = {'X-API-Key': 'app-secret'}


def po(**overrides):
    item = {'number': 'PO-2', 'vendor_id': 'V1', 'currency': 'USD', 'amount': '500.00',
            'received_amount': '500.00', 'issue_date': '2026-09-15'}
    item.update(overrides)
    return item


class PurchaseOrderUploadTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.BackendTests()
        self.fixture.setUp()
        f = self.fixture
        f.settings.api_key = 'app-secret'
        app = FastAPI()
        self.service = install(app, f.settings, f.service.extractor)
        self.client = TestClient(app)

    def tearDown(self):
        self.fixture.tearDown()

    def post(self, items, dry_run=False, reviewer='Priya Sharma'):
        return self.client.post('/api/v1/purchase-orders', headers=KEY,
                                json={'reviewer': reviewer, 'items': items, 'dry_run': dry_run})

    def numbers(self):
        return [p['number'] for p in self.client.get('/api/v1/references', headers=KEY).json()['purchase_orders']]

    def test_form_po_is_saved_and_merged_into_references(self):
        before = self.fixture.settings.procurement_path.read_bytes()
        response = self.post([po(tolerance_percent='2')])
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body['saved'])
        self.assertEqual(body['added'], 1)
        self.assertEqual(self.numbers(), ['PO-1', 'PO-2'])
        added = self.service.references()['purchase_orders'][-1]
        self.assertEqual(added['amount'], '500.00')
        self.assertEqual(added['tolerance_percent'], 2)
        self.assertEqual(added['previously_invoiced'], '0')
        self.assertEqual(added['source'], 'uploaded')
        self.assertEqual(added['uploaded_by'], 'reviewer:Priya Sharma')
        # The trusted master file is never rewritten.
        self.assertEqual(self.fixture.settings.procurement_path.read_bytes(), before)

    def test_currency_defaults_to_vendor_currency(self):
        self.fixture.settings.procurement_path.write_text(
            self.fixture.settings.procurement_path.read_text().replace('"approved": true', '"approved": true, "currency": "INR"'))
        self.assertTrue(self.post([po(currency='')]).json()['saved'])
        self.assertEqual(self.service.references()['purchase_orders'][-1]['currency'], 'INR')

    def test_dry_run_checks_without_saving(self):
        body = self.post([po()], dry_run=True).json()
        self.assertTrue(body['valid'])
        self.assertFalse(body['saved'])
        self.assertEqual(self.numbers(), ['PO-1'])

    def test_one_bad_row_saves_nothing_and_reports_each_problem(self):
        body = self.post([
            po(number='PO-3'),
            po(number='PO-1'),                                  # already in the master
            po(number='PO-3'),                                  # twice in this upload
            po(number='PO-4', vendor_id='V9'),                  # unknown vendor
            po(number='PO-5', amount='0'),                      # must be positive
            po(number='PO-6', received_amount='600'),           # more than the PO amount
            po(number='PO-7', issue_date='15/09/2026'),         # wrong date format
            po(number='PO-8', amount='12.345'),                 # too many decimals
            po(number='PO-9', currency='dollars'),              # not a 3-letter code
            po(number='PO-10', tolerance_percent='150'),        # out of range
        ]).json()
        self.assertFalse(body['saved'])
        self.assertFalse(body['valid'])
        errors = {r['row']: ' '.join(r['errors']) for r in body['rows']}
        self.assertEqual(errors[1], '')
        self.assertIn('already exists', errors[2])
        self.assertIn('more than once', errors[3])
        self.assertIn('Unknown vendor', errors[4])
        self.assertIn('greater than zero', errors[5])
        self.assertIn('cannot be more than the PO amount', errors[6])
        self.assertIn('YYYY-MM-DD', errors[7])
        self.assertIn('2 decimal places', errors[8])
        self.assertIn('3-letter code', errors[9])
        self.assertIn('between 0 and 100', errors[10])
        self.assertEqual(self.numbers(), ['PO-1'])

    def test_po_numbers_are_unique_case_insensitively_across_uploads(self):
        self.assertTrue(self.post([po()]).json()['saved'])
        body = self.post([po(number='po-2')]).json()
        self.assertFalse(body['saved'])
        self.assertIn('already exists', body['rows'][0]['errors'][0])

    def test_reviewer_name_and_key_are_required(self):
        self.assertEqual(self.post([po()], reviewer='').status_code, 422)
        response = self.client.post('/api/v1/purchase-orders', json={'reviewer': 'Priya', 'items': [po()]})
        self.assertEqual(response.status_code, 401)

    def test_csv_import_uses_spreadsheet_row_numbers(self):
        csv = ('﻿number,vendor_id,currency,amount,received_amount,previously_invoiced,tolerance_percent,issue_date\n'
               'PO-20,V1,USD,"1,200.00",1200,0,2,2026-09-20\n'
               '\n'
               'PO-21,V1,USD,300,0,,,2026-09-21\n')
        response = self.client.post('/api/v1/purchase-orders/csv?reviewer=Priya%20Sharma', headers={**KEY, 'Content-Type': 'text/csv'},
                                    content=csv.encode())
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body['saved'])
        self.assertEqual([r['row'] for r in body['rows']], [2, 4])
        self.assertEqual(self.numbers(), ['PO-1', 'PO-20', 'PO-21'])
        self.assertEqual(self.service.references()['purchase_orders'][1]['amount'], '1200.00')

    def test_csv_with_wrong_header_is_rejected_clearly(self):
        response = self.client.post('/api/v1/purchase-orders/csv?reviewer=Priya', headers={**KEY, 'Content-Type': 'text/csv'},
                                    content=b'po,vendor\nPO-1,V1\n')
        self.assertEqual(response.status_code, 400)
        message = response.json()['error']['message']
        self.assertIn('missing column(s)', message)
        self.assertIn('unknown column(s): po, vendor', message)

    def test_template_downloads_with_expected_columns(self):
        response = self.client.get('/api/v1/purchase-orders/template.csv', headers=KEY)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.text.startswith('number,vendor_id,currency,amount,received_amount,previously_invoiced,tolerance_percent,issue_date'))
        self.assertIn('V1', response.text)

    def test_invoice_against_uploaded_po_is_approved(self):
        f = self.fixture
        self.assertTrue(self.post([po(amount='110', received_amount='110')]).json()['saved'])
        e = fixtures.extraction(number='INV-PO2')
        f.e = e.model_copy(update={'po_reference': e.po_reference.model_validate(fixtures.field('PO-2'))})
        job_id = f.ingest()
        self.assertTrue(self.service.process_next())
        case = self.service.store.get(job_id)
        self.assertEqual(case['status'], 'approved', case['findings'])
        self.assertEqual(case['po_number'], 'PO-2')

    def test_reset_clears_uploaded_pos_but_keeps_the_master(self):
        self.assertTrue(self.post([po()]).json()['saved'])
        self.assertEqual(self.client.post('/api/v1/reset', headers=KEY).status_code, 200)
        self.assertEqual(self.numbers(), ['PO-1'])
        self.assertFalse(self.fixture.settings.po_uploads_path.exists())
        # A cleared number can be added again.
        self.assertTrue(self.post([po()]).json()['saved'])


if __name__ == '__main__':
    unittest.main()
