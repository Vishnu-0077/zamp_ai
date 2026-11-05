"""Deterministic checks on extracted fields; no PDF/OCR extraction or payment execution.

Pass extraction output plus trusted procurement references. This module never reads
expected.json. Empty findings mean these checks passed, not payment approval.
"""
from datetime import date
from decimal import Decimal, InvalidOperation


def check_document(fields, vendor, po, fx_rates, policy):
    findings=[]
    def flag(code,reason):
        findings.append({'code':code,'reason':reason,'action':'human_review'})
    def number(value):
        amount=Decimal(str(value))
        if not amount.is_finite():
            raise InvalidOperation
        return amount
    tolerance=number(policy.get('amount_tolerance','0.01'))
    def differs(a,b):return abs(number(a)-number(b))>tolerance
    kind=fields.get('document_type','').upper()
    if kind in ('CREDIT NOTE','DEBIT NOTE'):
        flag('adjustment_document',f'{kind} requires an adjustment workflow, not normal invoice payment.')
        if not fields.get('original_invoice'):
            flag('missing_original_invoice','Adjustment document has no original invoice reference.')
    elif kind!='INVOICE':
        flag('unknown_document_type','Confirm the document type before payment processing.')
    for key in ('number','date','vendor','po','currency','total'):
        if fields.get(key) in (None,''):
            flag('missing_'+key,f'Required field {key} is missing.')
    if not vendor or not vendor.get('approved'):
        flag('unapproved_vendor','Supplier is not in the approved vendor master.')
    elif not fields.get('bank_account'):
        flag('missing_bank_account','Invoice bank account is unavailable for verification.')
    elif fields['bank_account']!=vendor.get('bank_account'):
        flag('bank_account_changed','Invoice bank account differs from the trusted vendor master. Verify independently.')
    if not po:
        flag('unknown_po','Purchase order reference could not be resolved.')
    elif vendor and po['vendor_id']!=vendor['id']:
        flag('po_vendor_mismatch','Purchase order belongs to another vendor.')
    issued=None
    if fields.get('date'):
        try:
            issued=date.fromisoformat(fields['date'])
            as_of=date.fromisoformat(policy['as_of_date'])
            if issued>as_of:
                flag('future_invoice_date','Invoice is dated after the evaluation date.')
            if (as_of-issued).days>policy.get('max_invoice_age_days',365):
                flag('old_invoice','Invoice exceeds the configured maximum age.')
            if po and po.get('issue_date') and issued<date.fromisoformat(po['issue_date']):
                flag('invoice_before_po','Invoice date precedes the PO issue date.')
        except (ValueError,TypeError):
            flag('invalid_date','Invoice or PO date cannot be parsed unambiguously.')
    try:
        if kind=='INVOICE' and fields.get('total') is not None and number(fields['total'])<0:
            flag('negative_invoice','Negative invoice total requires classification review; do not infer a credit note.')
        if all(fields.get(k) is not None for k in ('subtotal','tax','total')):
            if differs(number(fields['subtotal'])+number(fields['tax']),fields['total']):
                flag('total_mismatch','Subtotal plus printed tax does not equal the printed total.')
        if fields.get('tax_profile')=='GST':
            components=fields.get('tax_components',[])
            names=[c['name'] for c in components]
            local=fields.get('supplier_state')==fields.get('place_of_supply')
            if (local and sorted(names)!=['CGST','SGST']) or (not local and names!=['IGST']):
                flag('gst_component_type','GST components do not match the supplied state/place-of-supply fixture policy.')
            expected_rate=number(fields['tax_rate'])/(2 if local else 1)
            for component in components:
                calculated=(number(fields['subtotal'])*number(component['rate'])/100).quantize(Decimal('.01'))
                if differs(component['rate'],expected_rate) or differs(component['amount'],calculated):
                    flag('gst_component_amount',component['name']+' amount or rate does not match the taxable value.')
            if differs(sum((number(c['amount']) for c in components),Decimal(0)),fields['tax']):
                flag('gst_split_total','CGST/SGST/IGST components do not sum to the printed total tax.')
        if fields.get('currency') and po and fields['currency']!=po['currency']:
            matches=[r for r in fx_rates if r.get('approved') and r['from_currency']==fields['currency']
                     and r['to_currency']==po['currency'] and r['date']==fields.get('date')]
            if len(matches)!=1 or number(matches[0]['rate'])<=0:
                flag('missing_fx_rate','A unique approved positive conversion rate for this currency pair and invoice date is required.')
            elif fields.get('total') is not None:
                converted=(number(fields['total'])*number(matches[0]['rate'])).quantize(Decimal('.01'))
                available=min(number(po['amount'])-number(po.get('previously_invoiced',0)),number(po['received_amount'])-number(po.get('previously_invoiced',0)))
                if converted>available+tolerance:
                    flag('converted_po_overrun','Converted total exceeds available PO or received value.')
    except (InvalidOperation,ValueError,TypeError,KeyError):
        flag('invalid_amount','Amounts or tax components are missing or not valid finite decimal values.')
    return findings
