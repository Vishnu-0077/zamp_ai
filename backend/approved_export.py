"""Excel register of approved invoices, for payment runs and ERP upload.

Built from the processing database on demand, so a download is always current.
The service also rewrites a copy on disk after every approval and reset.
"""
import io
import json
import logging
import os
import tempfile
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

log = logging.getLogger(__name__)

INVOICE_COLUMNS = [
    # header, width, kind
    ('Approved on (UTC)', 18, 'datetime'), ('Approval', 12, 'text'), ('Approved by', 22, 'text'),
    ('Vendor ID', 10, 'text'), ('Vendor name', 28, 'text'), ('Invoice number', 18, 'text'),
    ('Invoice date', 12, 'date'), ('Due date', 12, 'date'), ('PO number', 12, 'text'),
    ('Currency', 9, 'text'), ('Subtotal', 14, 'money'), ('Tax', 12, 'money'), ('Total', 14, 'money'),
    ('PO currency', 11, 'text'), ('Charged to PO', 14, 'money'),
    ('Bank account on vendor record', 24, 'text'), ('Bank account on invoice', 24, 'text'),
    ('Payment terms', 13, 'text'), ('Items', 40, 'wrap'), ('Reviewer note', 40, 'wrap'),
    ('Overridden issues', 28, 'wrap'), ('Source file', 30, 'text'), ('Inbox email', 11, 'text'), ('Case ID', 38, 'text'),
]
INVOICE_HEADERS = [c[0] for c in INVOICE_COLUMNS]
LINE_COLUMNS = [
    ('Invoice number', 18, 'text'), ('Vendor name', 28, 'text'), ('PO number', 12, 'text'), ('Line', 6, 'text'),
    ('Description', 44, 'wrap'), ('Quantity', 10, 'number'), ('Unit price', 13, 'money'), ('Amount', 14, 'money'),
    ('Currency', 9, 'text'), ('Case ID', 38, 'text'),
]


def _value(field):
    return field.get('value') if isinstance(field, dict) else None


def _decimal(raw):
    try:
        return Decimal(str(raw)) if raw not in (None, '') else None
    except (InvalidOperation, ValueError):
        return None


def _date(raw):
    try:
        return date.fromisoformat(str(raw)) if raw else None
    except ValueError:
        return None


def _datetime(raw):
    try:
        moment = datetime.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None
    # Excel has no time zones: store UTC wall-clock time, labelled in the header.
    return moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment


def approved_rows(connection):
    """One dict per approved case (oldest approval first), plus its line items."""
    rows = []
    for job in connection.execute("SELECT * FROM jobs WHERE status='approved' ORDER BY updated_at, id"):
        extraction = json.loads(job['extraction']) if job['extraction'] else {}
        if 'documents' in extraction:
            extraction = extraction['documents'][0] if len(extraction['documents']) == 1 else {}
        decision = json.loads(job['decision'] or '{}')
        checks = json.loads(job['checks'] or '{}')
        snapshot = json.loads(job['policy_snapshot'] or '{}')
        vendor = next((v for v in snapshot.get('vendors', []) if v.get('id') == job['vendor_id']), {})
        po = next((p for p in snapshot.get('purchase_orders', []) if p.get('number') == job['po_number']), {})
        manual = connection.execute(
            "SELECT actor, at, payload FROM audit WHERE job_id=? AND event='manual_approval' ORDER BY id DESC LIMIT 1",
            (job['id'],)).fetchone()
        note = json.loads(manual['payload']).get('note') if manual else None
        reservation = connection.execute('SELECT amount FROM reservations WHERE job_id=?', (job['id'],)).fetchone()
        lines = extraction.get('line_items') or []
        currency = _value(extraction.get('currency')) or job['currency']
        rows.append({
            'invoice': [
                _datetime(manual['at'] if manual else job['updated_at']),
                'Manual' if decision.get('manual_override') else 'Automatic',
                manual['actor'] if manual else 'System (all checks passed)',
                job['vendor_id'], vendor.get('name') or _value(extraction.get('vendor_name')),
                job['invoice_number'] or _value(extraction.get('invoice_number')),
                _date(_value(extraction.get('invoice_date')) or job['invoice_date']), _date(_value(extraction.get('due_date'))),
                job['po_number'], currency,
                _decimal(_value(extraction.get('subtotal'))), _decimal(_value(extraction.get('tax'))),
                _decimal(_value(extraction.get('total_amount')) or job['amount']),
                po.get('currency'), _decimal(reservation['amount'] if reservation else (checks.get('po_match') or {}).get('converted_total')),
                # Both accounts: a manual approval may have accepted a changed account; the
                # payment team must see the difference rather than have one silently chosen.
                vendor.get('bank_account'), _value(extraction.get('bank_details')), vendor.get('payment_terms'),
                '; '.join(str(_value(l.get('description')) or '') for l in lines if _value(l.get('description'))),
                note, ', '.join(decision.get('reason_codes', [])) if decision.get('manual_override') else None,
                job['filename'], job['email_id'], job['id'],
            ],
            'lines': [[
                job['invoice_number'], vendor.get('name') or _value(extraction.get('vendor_name')), job['po_number'], i + 1,
                _value(l.get('description')), _decimal(_value(l.get('quantity'))), _decimal(_value(l.get('unit_price'))),
                _decimal(_value(l.get('amount'))), currency, job['id'],
            ] for i, l in enumerate(lines)],
            'manual': bool(decision.get('manual_override')),
        })
    return rows


def build_workbook(connection):
    """Return the approved-invoice register as .xlsx bytes."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill('solid', fgColor='152D40')
    manual_fill = PatternFill('solid', fgColor='FDF1DC')
    formats = {'money': '#,##0.00', 'number': '#,##0.##', 'date': 'yyyy-mm-dd', 'datetime': 'yyyy-mm-dd hh:mm'}

    def sheet(ws, columns, data, highlight=()):
        ws.append([c[0] for c in columns])
        for cell in ws[1]:
            cell.font, cell.fill = header_font, header_fill
            cell.alignment = Alignment(vertical='center', wrap_text=True)
        for index, (_, width, _) in enumerate(columns, start=1):
            ws.column_dimensions[get_column_letter(index)].width = width
        for r, values in enumerate(data, start=2):
            ws.append(values)
            for c, (_, _, kind) in enumerate(columns, start=1):
                cell = ws.cell(row=r, column=c)
                if kind in formats:
                    cell.number_format = formats[kind]
                if kind == 'wrap':
                    cell.alignment = Alignment(wrap_text=True, vertical='top')
                if r - 2 in highlight:
                    cell.fill = manual_fill
        ws.freeze_panes = 'A2'
        ws.auto_filter.ref = ws.dimensions

    rows = approved_rows(connection)
    book = Workbook()
    invoices = book.active
    invoices.title = 'Approved invoices'
    sheet(invoices, INVOICE_COLUMNS, [r['invoice'] for r in rows], {i for i, r in enumerate(rows) if r['manual']})
    sheet(book.create_sheet('Line items'), LINE_COLUMNS, [line for r in rows for line in r['lines']])

    summary = book.create_sheet('Summary', 0)
    summary.column_dimensions['A'].width = 34
    for col in 'BCD':
        summary.column_dimensions[col].width = 18
    summary.append(['Approved invoice register'])
    summary['A1'].font = Font(bold=True, size=14)
    summary.append(['Generated (UTC)', datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)])
    summary['B2'].number_format = formats['datetime']
    summary.append(['Approved invoices', len(rows)])
    summary.append(['Approved manually by a reviewer', sum(r['manual'] for r in rows)])
    summary.append(['Manual approvals are highlighted in amber on the "Approved invoices" sheet.'])
    summary['A5'].font = Font(italic=True, color='5D6F83')
    summary.append([])
    by_currency, by_vendor = defaultdict(lambda: [0, Decimal(0)]), defaultdict(lambda: [0, Decimal(0)])
    for r in rows:
        values = r['invoice']
        total, currency = values[INVOICE_HEADERS.index('Total')] or Decimal(0), values[INVOICE_HEADERS.index('Currency')] or '—'
        by_currency[currency][0] += 1
        by_currency[currency][1] += total
        name = values[INVOICE_HEADERS.index('Vendor name')] or values[INVOICE_HEADERS.index('Vendor ID')] or 'Unknown'
        by_vendor[(name, currency)][0] += 1
        by_vendor[(name, currency)][1] += total
    for title, table, heads in (('Totals by currency', by_currency, ['Currency', 'Invoices', 'Total']),
                                ('Totals by vendor', by_vendor, ['Vendor', 'Currency', 'Invoices', 'Total'])):
        summary.append([title])
        summary.cell(row=summary.max_row, column=1).font = Font(bold=True, size=12)
        summary.append(heads)
        for cell in summary[summary.max_row]:
            cell.font, cell.fill = header_font, header_fill
        for key, (count, total) in sorted(table.items(), key=lambda kv: str(kv[0])):
            summary.append([*(key if isinstance(key, tuple) else (key,)), count, total])
            summary.cell(row=summary.max_row, column=len(heads)).number_format = formats['money']
        summary.append([])

    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def write_file(connection, path: Path):
    """Atomically replace the on-disk register so readers never see a half-written file."""
    data = build_workbook(connection)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.approved-', suffix='.xlsx', delete=False) as handle:
        handle.write(data)
        temporary = handle.name
    try:
        os.chmod(temporary, 0o644)  # temp files are owner-only; the register is meant to be shared
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
