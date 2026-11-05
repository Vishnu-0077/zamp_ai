"""Enrich existing case IDs; do not add or replace email scenarios."""

AS_OF = '2026-11-02'
POLICY = {'as_of_date': AS_OF, 'max_invoice_age_days': 365, 'amount_tolerance': '0.01',
          'bank_change_action': 'human_review', 'adjustment_action': 'human_review',
          'fx_rate_convention': 'PO currency units per 1 invoice currency unit'}
FX_RATES = [{'from_currency':'USD','to_currency':'INR','date':'2026-10-14',
             'rate':'83.50','approved':True,'source':'Synthetic treasury-approved demo rate, not a live quote'}]


def enrich(idx, fields):
    fields['bank_account'] = 'DEMO-ACCOUNT-' + str((idx-1)%5+1).zfill(3)
    if idx == 45:
        fields['bank_account'] = 'DEMO-ACCOUNT-CHANGED-999'
    if idx in (13, 18, 48):
        fields.update(tax_profile='GST', supplier_state='29', place_of_supply='27' if idx==13 else '29',
                      buyer_address='200 Demo Industrial Road, Mumbai, Maharashtra' if idx==13 else '200 Demo Industrial Road, Bengaluru, Karnataka',
                      supplier_branch='Bengaluru branch, Karnataka (29)', tax_rate=18)
        fields['currency']='INR'
        if idx==13:
            fields['tax_components']=[{'name':'IGST','rate':18,'amount':round(fields['subtotal']*.18,2)}]
        else:
            fields['tax_components']=[{'name':'CGST','rate':9,'amount':round(fields['subtotal']*.09,2)},
                                      {'name':'SGST','rate':9,'amount':round(fields['subtotal']*.09,2)}]
        fields['tax']=round(sum(c['amount'] for c in fields['tax_components']),2)
        fields['total']=round(fields['subtotal']+fields['tax'],2)
        if idx==48:
            fields['tax_components'][1]['amount']+=75
            fields['date']='2026-09-15'
            fields['due_date']='2026-10-15'
            # Keep printed aggregate tax and total unchanged: the split no longer adds up.
    if idx==44:
        for key in ('unit_price','subtotal','tax','total'):
            fields[key]=-abs(fields[key])
    if idx==46:
        fields['date']='2026-12-01'
        fields['due_date']='2026-12-31'
    if idx==49:
        fields.update(document_type='CREDIT NOTE',original_invoice='004-2026-0004',
                      po='PO-26004',description='Credit for returned shipping cartons',quantity=1,
                      unit_price=-48,subtotal=-48,tax=-4.8,total=-52.8)
    if idx==50:
        fields.update(currency='EUR',date='2024-01-15')
    return fields


def debit_note():
    return dict(document_type='DEBIT NOTE',vendor='Harbor IT Services',number='HI-DN-2026-0047',
                original_invoice='002-2026-0002',date='2026-10-28',due_date='2026-11-27',
                po='PO-26002',description='Additional support hours omitted from original billing',
                quantity=1,unit_price=100,subtotal=100,tax=10,total=110,currency='USD',terms='Net 30',
                contact='Daniel Reed',address='102 Market Street, Portland, OR 97205',phone='+1-202-555-0142',
                bank_account='DEMO-ACCOUNT-002')


def bundled_invoice():
    fields=debit_note()
    fields.update(document_type='INVOICE',number='HI-2026-EXTRA-0047',po='PO-EXTRA-0047',
                  description='Replacement workstation setup',unit_price=250,subtotal=250,tax=25,total=275)
    fields.pop('original_invoice')
    return fields


ADDED_FEATURES = {
    12:['approved_foreign_currency_conversion'],
    13:['valid_igst'],18:['valid_cgst_sgst'],
    43:['multipage_total_on_last_page'],
    44:['negative_invoice_not_credit_note'],
    45:['bank_account_change'],
    46:['future_invoice_date'],
    47:['multiple_invoices_one_pdf','debit_note'],
    48:['gst_split_arithmetic_error','invoice_before_po'],
    49:['credit_note'],
    50:['foreign_currency_missing_rate','very_old_invoice'],
}
ADDED_REASONS = {
    43:'Two-page scanned invoice: reconcile the same invoice across pages and read the total only on page 2.',
    44:'Negative total is still labelled INVOICE, not CREDIT NOTE; never approve it as a normal payable.',
    45:'Invoice bank account differs from vendor master; independent bank verification is mandatory.',
    46:'Invoice date 2026-12-01 is after the fixed evaluation date 2026-11-02.',
    47:'The PDF also contains a separate complete invoice and a debit note referencing a historical invoice; split documents and route the adjustment for review.',
    48:'CGST/SGST split does not sum to printed tax; invoice is dated before PO issue date.',
    49:'A credit note referencing invoice 004-2026-0004 requires adjustment handling, not normal payment approval.',
    50:'EUR invoice has no approved EUR-to-INR rate and is older than the fixture policy of 365 days.',
}
