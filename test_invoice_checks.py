"""Boundary and regression checks using extraction inputs, not expected labels."""
import copy
import json
from pathlib import Path
import unittest
from invoice_checks import check_document

ROOT=Path(__file__).resolve().parent

class InvoiceChecksTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        refs=json.loads((ROOT/'test_inputs/ground_truth/procurement.json').read_text())
        fixtures=json.loads((ROOT/'test_inputs/ground_truth/expected.json').read_text())
        # Use only source fields; none of the expected labels/reasons feed the checks.
        cls.fields=fixtures[0]['fields']
        cls.vendor=refs['vendors'][0]
        cls.po=refs['purchase_orders'][0]
        cls.policy=refs['validation_policy']

    def codes(self,fields,po=None,rates=None):
        return {r['code'] for r in check_document(fields,self.vendor,po or self.po,rates or [],self.policy)}

    def test_bank_change_alone_always_routes_to_review(self):
        fields=copy.deepcopy(self.fields)
        self.assertEqual(self.codes(fields),set())
        fields['bank_account']='DEMO-NEW-UNVERIFIED'
        self.assertEqual(self.codes(fields),{'bank_account_changed'})

    def test_negative_invoice_is_not_silently_reclassified(self):
        fields=copy.deepcopy(self.fields)
        for key in ('unit_price','subtotal','tax','total'):fields[key]=-fields[key]
        self.assertEqual(self.codes(fields),{'negative_invoice'})
        fields['document_type']='CREDIT NOTE'
        self.assertEqual(self.codes(fields),{'adjustment_document','missing_original_invoice'})
        fields['original_invoice']='PRIOR-001'
        self.assertEqual(self.codes(fields),{'adjustment_document'})

    def test_future_and_age_boundaries_use_fixed_policy_date(self):
        fields=copy.deepcopy(self.fields)
        fields['date']='2026-11-02'
        self.assertFalse(self.codes(fields))
        fields['date']='2026-11-03'
        self.assertEqual(self.codes(fields),{'future_invoice_date'})
        fields['date']='2025-11-02'
        po=self.po|{'issue_date':'2025-01-01'}
        self.assertFalse(self.codes(fields,po))
        fields['date']='2025-11-01'
        self.assertEqual(self.codes(fields,po),{'old_invoice'})

    def test_foreign_currency_requires_approved_dated_rate_and_correct_direction(self):
        fields=copy.deepcopy(self.fields)
        po=self.po|{'currency':'INR','amount':23513.60,'received_amount':23513.60}
        rate={'from_currency':'USD','to_currency':'INR','date':fields['date'],'rate':'83.5','approved':True}
        self.assertEqual(self.codes(fields,po),{'missing_fx_rate'})
        self.assertFalse(self.codes(fields,po,[rate]))
        for invalid in [rate|{'approved':False},rate|{'date':'2020-01-01'},rate|{'rate':'0'},rate|{'from_currency':'INR','to_currency':'USD'}]:
            self.assertEqual(self.codes(fields,po,[invalid]),{'missing_fx_rate'})
        self.assertEqual(self.codes(fields,po,[rate,rate]),{'missing_fx_rate'})

    def test_gst_wrong_split_is_caught_even_when_grand_total_adds_up(self):
        fields=copy.deepcopy(self.fields)
        fields.update(tax_profile='GST',supplier_state='29',place_of_supply='29',tax_rate=18,
                      subtotal=100,tax=18,total=118,
                      tax_components=[{'name':'CGST','rate':9,'amount':9},{'name':'SGST','rate':9,'amount':9}])
        self.assertFalse(self.codes(fields))
        fields['tax_components'][1]['amount']=12
        self.assertEqual(self.codes(fields),{'gst_component_amount','gst_split_total'})
        fields['tax_components']=[{'name':'IGST','rate':18,'amount':18}]
        self.assertIn('gst_component_type',self.codes(fields))

if __name__=='__main__':unittest.main()
