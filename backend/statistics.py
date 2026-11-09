"""Statistics over processed cases: totals, per vendor and per problem.

A *problem* is a finding code raised on a case (counted once per case, however
many times it was raised). Processing problems (OCR or model failures) are
system issues rather than something a vendor did, so they are reported
separately and never count against a vendor.
"""
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

from .database import now

PROCESSING_CODES = frozenset({'OCR_UNAVAILABLE', 'OCR_FAILED', 'EXTRACTION_NOT_CONFIGURED',
                              'EXTRACTION_SCHEMA_FAILED', 'PROCESSING_ERROR'})
FINISHED = ('approved', 'review', 'duplicate')
STATUSES = ('queued', 'processing', 'review', 'approved', 'duplicate')


def _json(text, default):
    try:
        return json.loads(text) if text else default
    except (TypeError, ValueError):
        return default


def _money(totals: dict) -> list[dict]:
    return [{'currency': c, 'amount': str(a)} for c, a in sorted(totals.items())]


def _add(totals: dict, currency, amount):
    if amount in (None, ''):
        return
    try:
        totals[currency or '—'] += Decimal(str(amount))
    except InvalidOperation:
        pass


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def _vendor_of(row, extraction, names) -> tuple[str, str, bool]:
    """(key, display name, in vendor master)."""
    if row['vendor_id']:
        return row['vendor_id'], names.get(row['vendor_id'], row['vendor_id']), row['vendor_id'] in names
    doc = extraction or {}
    if 'documents' in doc:  # a bundled PDF: name it after the first document
        doc = (doc.get('documents') or [{}])[0]
    printed = ((doc.get('vendor_name') or {}).get('value') or '').strip()
    if printed:
        return 'name:' + printed.lower(), printed, False
    return 'unidentified', 'Vendor not identified', False


def compute(rows, refs) -> dict:
    names = {v['id']: v.get('name') or v['id'] for v in refs.get('vendors', [])}
    by_status = Counter()
    manual = 0
    approved_value, held_value = defaultdict(Decimal), defaultdict(Decimal)
    vendors: dict[str, dict] = {}
    problems: dict[str, dict] = {}
    cases_with_problems = cases_with_vendor_problems = processing_cases = 0

    for row in rows:
        status = row['status']
        by_status[status] += 1
        decision = _json(row['decision'], {}) or {}
        findings = _json(row['findings'], [])
        extraction = _json(row['extraction'], None)
        is_manual = status == 'approved' and bool(decision.get('manual_override'))
        manual += is_manual
        if status == 'approved':
            _add(approved_value, row['currency'], row['amount'])
        elif status == 'review':
            _add(held_value, row['currency'], row['amount'])

        key, name, in_master = _vendor_of(row, extraction, names)
        v = vendors.setdefault(key, {
            'key': key, 'vendor_id': row['vendor_id'] if in_master else None, 'name': name, 'in_master': in_master,
            'cases': 0, 'approved': 0, 'approved_manual': 0, 'review': 0, 'duplicate': 0, 'in_progress': 0,
            'problem_cases': 0, '_problems': Counter(), '_value': defaultdict(Decimal)})
        v['cases'] += 1
        if status in ('approved', 'review', 'duplicate'):
            v[status] += 1
        else:
            v['in_progress'] += 1
        v['approved_manual'] += is_manual
        if status == 'approved':
            _add(v['_value'], row['currency'], row['amount'])

        # Each code once per case; reason codes cover a decision whose findings were cleared.
        codes = {str(f.get('code', '')).upper() for f in findings if f.get('code')}
        codes |= {str(c).upper() for c in decision.get('reason_codes') or []}
        fields = defaultdict(set)
        for f in findings:
            if f.get('code') and f.get('field'):
                fields[str(f['code']).upper()].add(f['field'])
        if codes:
            cases_with_problems += 1
        processing_cases += bool(codes & PROCESSING_CODES)
        vendor_codes = codes - PROCESSING_CODES
        if vendor_codes:
            cases_with_vendor_problems += 1
            v['problem_cases'] += 1
            v['_problems'].update(vendor_codes)
        for code in codes:
            p = problems.setdefault(code, {'code': code, 'category': 'processing' if code in PROCESSING_CODES else 'invoice',
                                           'cases': 0, '_vendors': Counter(), '_fields': Counter(), '_names': {}})
            p['cases'] += 1
            p['_vendors'][key] += 1
            p['_names'][key] = name
            p['_fields'].update(fields.get(code, ()))

    total = sum(by_status.values())
    finished = sum(by_status[s] for s in FINISHED)

    vendor_list = []
    for v in vendors.values():
        counts = v.pop('_problems')
        value = v.pop('_value')
        done = v['approved'] + v['review'] + v['duplicate']
        top = max(counts.values(), default=0)
        vendor_list.append({
            **v,
            'problem_rate': _rate(v['problem_cases'], done),
            'approval_rate': _rate(v['approved'], done),
            'problem_occurrences': sum(counts.values()),
            'problems': [{'code': c, 'cases': n} for c, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))],
            # Every code tied for the top spot, so a tie is never hidden.
            'top_problems': sorted(c for c, n in counts.items() if n == top) if top else [],
            'top_problem_cases': top,
            'approved_value': _money(value),
        })
    rank = lambda v: (v['problem_cases'], v['problem_rate'] or 0, v['problem_occurrences'])
    vendor_list.sort(key=lambda v: (*(-x for x in rank(v)), v['name'].lower()))

    problem_list = []
    for p in problems.values():
        vendor_counts, names_by_key = p.pop('_vendors'), p.pop('_names')
        problem_list.append({
            **{k: p[k] for k in ('code', 'category', 'cases')},
            'share_of_cases': _rate(p['cases'], total),
            'vendors': [{'key': k, 'name': names_by_key[k], 'cases': n}
                        for k, n in sorted(vendor_counts.items(), key=lambda kv: (-kv[1], names_by_key[kv[0]].lower()))],
            'fields': [{'field': f, 'cases': n} for f, n in p.pop('_fields').most_common()],
        })
    problem_list.sort(key=lambda p: (p['category'] != 'invoice', -p['cases'], p['code']))

    worst = [v for v in vendor_list if v['problem_cases']]
    worst = [v['key'] for v in worst if rank(v) == rank(worst[0])] if worst else []
    invoice_problems = [p for p in problem_list if p['category'] == 'invoice']
    top_problem = invoice_problems[0]['cases'] if invoice_problems else 0

    return {
        'generated_at': now(),
        'totals': {
            'cases': total,
            'by_status': {s: by_status[s] for s in STATUSES},
            'finished': finished,
            'approved_automatic': by_status['approved'] - manual,
            'approved_manual': manual,
            'approval_rate': _rate(by_status['approved'], finished),
            'straight_through_rate': _rate(by_status['approved'] - manual, finished),
            'cases_with_problems': cases_with_problems,
            'cases_with_invoice_problems': cases_with_vendor_problems,
            'cases_with_processing_problems': processing_cases,
            'vendors': len(vendor_list),
            'approved_value': _money(approved_value),
            'held_value': _money(held_value),
        },
        'vendors': vendor_list,
        'problems': problem_list,
        'highlights': {
            'most_problematic_vendors': worst,
            'most_common_problems': [p['code'] for p in invoice_problems if p['cases'] == top_problem] if top_problem else [],
        },
    }
