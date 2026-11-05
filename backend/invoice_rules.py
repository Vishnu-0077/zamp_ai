"""Pure deterministic rules. Monetary arithmetic uses Decimal exclusively."""
import re
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
from .invoice_checks import check_document
from .schemas import ExtractedField

RULE_VERSION = 'invoice-rules-v1'
CRITICAL = {'vendor_name', 'invoice_number', 'invoice_date', 'currency', 'po_reference', 'total_amount', 'bank_details'}
REQUIRED = CRITICAL | {'document_type', 'due_date', 'subtotal', 'tax'}


def normalize(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').casefold())


def evaluate(extraction, pages, refs, existing, reservations, settings, verified=frozenset()):
    findings, checks = [], {}
    policy = refs['policy']
    tolerance = Decimal(str(policy.get('amount_tolerance', '.01')))
    def flag(code, message, field=None):
        finding = {'code': code, 'message': message, 'stage': 'validation', 'field': field}
        if finding not in findings:
            findings.append(finding)
    def inspect(name, field):
        if field.value is None or field.value == '':
            if name in REQUIRED or name.startswith('line_items.'):
                flag('MISSING_' + name.upper().replace('.', '_'), f'{name} is required.', name)
            checks[name] = {'status': 'missing'}
            return
        page = next((p for p in pages if p['page'] == field.page), None)
        evidence_ok = bool(page and field.evidence and field.evidence in page['text'])
        ocr_ok = bool(page and (page['route'] == 'digital' or (page['ocr_confidence'] or 0) >= settings.ocr_min_confidence))
        confidence_ok = field.confidence == 'high' if name in CRITICAL else field.confidence != 'low'
        human = name in verified
        # A quoted passage alone cannot attest that the normalized value was read correctly.
        value_ok = True
        if not human and field.evidence:
            if isinstance(field.value, Decimal):
                tokens = re.findall(r'[-+]?\d[\d,]*(?:\.\d+)?', field.evidence)
                value_ok = any(Decimal(t.replace(',', '')) == field.value for t in tokens)
            elif isinstance(field.value, str) and name not in {'invoice_date', 'due_date'}:
                value_ok = normalize(field.value) in normalize(field.evidence)
        checks[name] = {'evidence_found': evidence_ok, 'value_supported': value_ok,
                        'ocr_pass': ocr_ok, 'model_pass': confidence_ok, 'human_verified': human,
                        'status': 'passed' if human or all((evidence_ok, value_ok, ocr_ok, confidence_ok)) else 'low'}
        if not human:
            if not evidence_ok: flag('EVIDENCE_NOT_FOUND', f'{name} evidence was not found on its cited page.', name)
            if not value_ok: flag('VALUE_NOT_SUPPORTED', f'{name} does not match its quoted evidence.', name)
            if not ocr_ok: flag('LOW_OCR_CONFIDENCE', f'{name} requires visual verification.', name)
            if not confidence_ok: flag('LOW_FIELD_CONFIDENCE', f'{name} confidence is below policy.', name)
    for name in extraction.__class__.model_fields:
        field = getattr(extraction, name)
        if isinstance(field, ExtractedField): inspect(name, field)
    for i, line in enumerate(extraction.line_items):
        for name in line.__class__.model_fields:
            inspect(f'line_items.{i}.{name}', getattr(line, name))
    values = {name: getattr(extraction, name).value for name in extraction.__class__.model_fields if name != 'line_items'}
    for name in ('invoice_date', 'due_date'):
        if values[name]:
            try:
                parsed = date.fromisoformat(values[name])
                # ISO date must also occur in evidence or an unambiguous supported display form.
                ev = getattr(extraction, name).evidence or ''
                variants = [parsed.isoformat(), parsed.strftime('%d %b %Y'), parsed.strftime('%B %d, %Y'), parsed.strftime('%d %B %Y')]
                if name not in verified and not any(v.casefold() in ev.casefold() for v in variants):
                    flag('DATE_EVIDENCE_AMBIGUOUS', f'{name} requires verification of date interpretation.', name)
            except ValueError:
                flag('INVALID_DATE', f'{name} must be a real ISO date.', name)
    if values['due_date'] and values['invoice_date']:
        try:
            if date.fromisoformat(values['due_date']) < date.fromisoformat(values['invoice_date']):
                flag('DUE_BEFORE_INVOICE', 'Due date precedes invoice date.', 'due_date')
        except ValueError: pass
    if values['currency'] and not re.fullmatch('[A-Z]{3}', values['currency']):
        flag('INVALID_CURRENCY', 'Currency must be a three-letter uppercase code.', 'currency')
    vendors = [v for v in refs['vendors'] if normalize(v['name']) == normalize(values['vendor_name'])]
    vendor = vendors[0] if len(vendors) == 1 else None
    pos = refs['purchase_orders']
    candidates = []
    if values['po_reference']:
        candidates = [p for p in pos if normalize(p['number']) == normalize(values['po_reference'])]
    elif vendor:
        # Advisory candidate list only; missing printed PO still requires review.
        candidates = [p for p in pos if p['vendor_id'] == vendor['id'] and p['currency'] == values['currency']
                      and values['total_amount'] is not None and abs(Decimal(str(p['amount'])) - values['total_amount']) <= tolerance]
        try:
            issued = date.fromisoformat(values['invoice_date'])
            candidates = [p for p in candidates if p.get('issue_date') and 0 <= (issued - date.fromisoformat(p['issue_date'])).days <= policy.get('po_date_window_days', 365)]
        except (TypeError, ValueError):
            candidates = []
    po = candidates[0] if len(candidates) == 1 else None
    if len(candidates) > 1: flag('AMBIGUOUS_PO', 'Multiple PO candidates remain; a reviewer must resolve them.', 'po_reference')
    flat = {'document_type': values['document_type'] or '', 'original_invoice': values['original_invoice'],
            'vendor': values['vendor_name'], 'number': values['invoice_number'], 'date': values['invoice_date'],
            'po': values['po_reference'], 'currency': values['currency'], 'total': values['total_amount'],
            'subtotal': values['subtotal'], 'tax': values['tax'], 'bank_account': values['bank_details'],
            'tax_profile': values['tax_profile'], 'tax_rate': values['tax_rate'],
            'supplier_state': values['supplier_state'], 'place_of_supply': values['place_of_supply'],
            'tax_components': [x.model_dump() for x in values['tax_components']] if values['tax_components'] else []}
    for f in check_document(flat, vendor, po, refs.get('fx_rates', []), policy):
        flag(f['code'].upper(), f['reason'])
    if not extraction.line_items: flag('MISSING_LINE_ITEMS', 'No invoice line items were extracted.', 'line_items')
    lines_total = Decimal(0)
    for index, line in enumerate(extraction.line_items):
        q, unit, amount = line.quantity.value, line.unit_price.value, line.amount.value
        if None not in (q, unit, amount):
            if abs(q * unit - amount) > tolerance:
                flag('LINE_MATH_MISMATCH', f'Line {index + 1} quantity times unit price differs from amount.', f'line_items.{index}')
            lines_total += amount
    if values['subtotal'] is not None and abs(lines_total - values['subtotal']) > tolerance:
        flag('SUBTOTAL_MISMATCH', 'Line amounts do not sum to subtotal.', 'subtotal')
    for name in ('subtotal', 'tax', 'total_amount'):
        if values[name] is not None and values[name] < 0:
            flag('NEGATIVE_AMOUNT', f'{name} cannot be negative in the invoice workflow.', name)
    if values['total_amount'] == 0:
        flag('ZERO_TOTAL', 'Zero-value invoices require review.', 'total_amount')
    exact = []
    if vendor and values['invoice_number']:
        for old in existing:
            if old['vendor_id'] != vendor['id']: continue
            if normalize(old['invoice_number']) == normalize(values['invoice_number']):
                exact.append(old['id']) if old['status'] == 'approved' else flag('POSSIBLE_DUPLICATE', f'Invoice identity matches unresolved case {old["id"]}.')
            elif (old['currency'] == values['currency'] and old['amount'] is not None and values['total_amount'] is not None
                  and abs(Decimal(old['amount']) - values['total_amount']) <= tolerance):
                try:
                    close_date = abs((date.fromisoformat(old['invoice_date']) - date.fromisoformat(values['invoice_date'])).days) <= policy.get('duplicate_date_window_days', 7)
                except (ValueError, TypeError): close_date = False
                similar = SequenceMatcher(None, normalize(old['invoice_number']), normalize(values['invoice_number'])).ratio() >= .8
                if close_date and (similar or (po and old['po_number'] == po['number'])):
                    flag('POSSIBLE_DUPLICATE', f'Invoice resembles case {old["id"]}.')
    if exact: flag('DUPLICATE_INVOICE', 'Vendor and invoice number match: ' + ', '.join(exact))
    converted = None
    if po and values['total_amount'] is not None:
        converted = values['total_amount']
        if values['currency'] != po['currency']:
            rates = [r for r in refs.get('fx_rates', []) if r.get('approved') and r['from_currency'] == values['currency']
                     and r['to_currency'] == po['currency'] and r['date'] == values['invoice_date'] and Decimal(str(r['rate'])) > 0]
            converted = (converted * Decimal(str(rates[0]['rate']))).quantize(Decimal('.01')) if len(rates) == 1 else None
        if converted is not None:
            used = sum((Decimal(r['amount']) for r in reservations if r['po_number'] == po['number']), Decimal(0))
            previous = Decimal(str(po.get('previously_invoiced', 0)))
            balance = Decimal(str(po['amount'])) - previous - used
            received = Decimal(str(po['received_amount'])) - previous - used
            # A hard balance cap; tolerance never permits spending already reserved value.
            if converted > balance + tolerance: flag('PO_BALANCE_EXCEEDED', 'Invoice exceeds remaining PO balance.')
            if converted > received + tolerance: flag('RECEIPT_BALANCE_EXCEEDED', 'Invoice exceeds unbilled received value.')
            checks['po_match'] = {'balance': str(balance), 'received_balance': str(received), 'converted_total': str(converted), 'currency': po['currency']}
    for finding in findings:
        code = finding['code']
        if code in {'UNAPPROVED_VENDOR', 'BANK_ACCOUNT_CHANGED', 'MISSING_BANK_ACCOUNT'}:
            finding['stage'] = 'vendor_check'
        elif code in {'DUPLICATE_INVOICE', 'POSSIBLE_DUPLICATE'}:
            finding['stage'] = 'duplicate_check'
        elif code in {'UNKNOWN_PO', 'AMBIGUOUS_PO', 'MISSING_PO_REFERENCE', 'MISSING_PO'}:
            finding['stage'] = 'po_identification'
        elif code in {'PO_VENDOR_MISMATCH', 'PO_BALANCE_EXCEEDED', 'RECEIPT_BALANCE_EXCEEDED', 'MISSING_FX_RATE', 'CONVERTED_PO_OVERRUN'}:
            finding['stage'] = 'po_matching'
    math_fields = {'TOTAL_MISMATCH': ['subtotal', 'tax', 'total_amount'],
                   'SUBTOTAL_MISMATCH': ['subtotal', 'total_amount'],
                   'LINE_MATH_MISMATCH': ['subtotal', 'total_amount']}
    for finding in findings:
        for key in math_fields.get(finding['code'], []):
            checks.setdefault(key, {}).update({'math_pass': False, 'status': 'low'})
    checks['po_candidates'] = [p['number'] for p in candidates]
    checks['rule_version'] = RULE_VERSION
    # Exact identity is only terminal when its identity fields passed verification.
    identity_ok = all(checks.get(k, {}).get('status') == 'passed' for k in ('vendor_name', 'invoice_number'))
    outcome = 'duplicate' if exact and identity_ok else 'review' if findings else 'approved'
    return {'outcome': outcome, 'findings': findings, 'checks': checks, 'vendor': vendor, 'po': po, 'converted': converted,
            'values': values}
