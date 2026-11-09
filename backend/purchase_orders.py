"""Purchase orders added through the dashboard (form or CSV).

Uploaded POs are kept in their own JSON file beside the processing database, not
in backend/procurement.json, so the trusted master stays untouched and versioned.
They are merged into the reference data for every new validation and are
removed by every reset (dashboard "Refresh & start fresh" and RESET_ON_START),
so each fresh start goes back to the built-in POs. A person enters every value;
no model output ever reaches this file.
"""
import csv
import io
import json
import os
import re
import tempfile
import threading
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .database import now

# Column order of the CSV template and of the form.
COLUMNS = ('number', 'vendor_id', 'currency', 'amount', 'received_amount',
           'previously_invoiced', 'tolerance_percent', 'issue_date')
REQUIRED_COLUMNS = ('number', 'vendor_id', 'amount', 'received_amount', 'issue_date')
MAX_ROWS = 1000
NUMBER_PATTERN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,63}')
CURRENCY_PATTERN = re.compile(r'[A-Z]{3}')


class PurchaseOrderStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def load(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text())
        except FileNotFoundError:
            return []
        return data if isinstance(data, list) else []

    def clear(self):
        with self.lock:
            self.path.unlink(missing_ok=True)

    def _save(self, items: list[dict]):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix='.purchase_orders.', suffix='.json')
        try:
            with os.fdopen(fd, 'w') as handle:
                json.dump(items, handle, indent=2)
            os.replace(tmp, self.path)  # atomic: readers see the old or the new file, never half of one
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def add(self, rows: list[tuple[int, dict]], refs: dict, actor: str, dry_run: bool) -> dict:
        """Validate every row; save all of them only when none has an error."""
        if not rows:
            raise ValueError('Add at least one purchase order.')
        if len(rows) > MAX_ROWS:
            raise ValueError(f'At most {MAX_ROWS} purchase orders per upload.')
        with self.lock:
            # refs already includes previously uploaded POs, so numbers stay unique across both.
            vendors = {v['id']: v for v in refs.get('vendors', [])}
            taken = {str(p['number']).strip().upper() for p in refs.get('purchase_orders', [])}
            results, clean, seen = [], [], set()
            for row_number, item in rows:
                record, errors = _validate(item, vendors, taken, seen)
                results.append({'row': row_number, 'number': record.get('number') or None, 'errors': errors})
                if not errors:
                    clean.append(record)
            ok = all(not r['errors'] for r in results)
            saved = ok and not dry_run
            if saved:
                stamp = now()
                for record in clean:
                    record.update(source='uploaded', uploaded_by=actor, uploaded_at=stamp)
                self._save(self.load() + clean)
            return {'saved': saved, 'valid': ok, 'added': len(clean) if saved else 0, 'rows': results}


def _text(item: dict, key: str) -> str:
    value = item.get(key)
    return '' if value is None else str(value).strip()


def _decimal(item, key, label, errors, required=True, default='0', positive=False):
    raw = _text(item, key).replace(',', '')
    if not raw:
        if required:
            errors.append(f'{label} is required.')
            return None
        raw = default
    try:
        value = Decimal(raw)
        if not value.is_finite():
            raise InvalidOperation
    except InvalidOperation:
        errors.append(f'{label} must be a number such as 1234.50 (got "{raw}").')
        return None
    if value < 0 or (positive and value == 0):
        errors.append(f'{label} must be {"greater than zero" if positive else "zero or more"}.')
        return None
    if value.as_tuple().exponent < -2:
        errors.append(f'{label} can have at most 2 decimal places.')
        return None
    return value


def _validate(item: dict, vendors: dict, taken: set, seen: set) -> tuple[dict, list[str]]:
    errors: list[str] = []
    unknown = sorted(set(item) - set(COLUMNS))
    if unknown:
        errors.append('Unknown field(s): ' + ', '.join(unknown) + '.')

    number = _text(item, 'number')
    key = number.upper()
    if not number:
        errors.append('PO number is required.')
    elif not NUMBER_PATTERN.fullmatch(number):
        errors.append('PO number may only use letters, digits and . _ / - (up to 64 characters).')
    elif key in taken:
        errors.append(f'PO {number} already exists.')
    elif key in seen:
        errors.append(f'PO {number} appears more than once in this upload.')
    if number:
        seen.add(key)

    vendor_id = _text(item, 'vendor_id')
    vendor = vendors.get(vendor_id)
    if not vendor_id:
        errors.append('Vendor is required.')
    elif vendor is None:
        errors.append(f'Unknown vendor ID "{vendor_id}". Use an ID from Reference data → Vendors.')

    currency = _text(item, 'currency').upper() or (vendor or {}).get('currency', '')
    if not currency:
        errors.append('Currency is required.')
    elif not CURRENCY_PATTERN.fullmatch(currency):
        errors.append(f'Currency must be a 3-letter code such as USD (got "{currency}").')

    amount = _decimal(item, 'amount', 'PO amount', errors, positive=True)
    received = _decimal(item, 'received_amount', 'Received amount', errors)
    previous = _decimal(item, 'previously_invoiced', 'Previously invoiced', errors, required=False)
    tolerance = _decimal(item, 'tolerance_percent', 'Tolerance %', errors, required=False)
    if amount is not None and received is not None and received > amount:
        errors.append('Received amount cannot be more than the PO amount.')
    if amount is not None and previous is not None and previous > amount:
        errors.append('Previously invoiced cannot be more than the PO amount.')
    if tolerance is not None and tolerance > 100:
        errors.append('Tolerance % must be between 0 and 100.')

    issue_date = _text(item, 'issue_date')
    if not issue_date:
        errors.append('Issue date is required.')
    else:
        try:
            date.fromisoformat(issue_date)
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', issue_date):
                raise ValueError
        except ValueError:
            errors.append(f'Issue date must be YYYY-MM-DD (got "{issue_date}").')

    record = {'number': number}
    if not errors:
        # Amounts are stored as exact decimal strings; the rules read them with Decimal(str(...)).
        record = {
            'number': number, 'vendor_id': vendor_id, 'currency': currency,
            'amount': str(amount), 'received_amount': str(received), 'previously_invoiced': str(previous),
            'tolerance_percent': int(tolerance) if tolerance == tolerance.to_integral_value() else float(tolerance),
            'issue_date': issue_date,
        }
    return record, errors


def parse_csv(content: bytes) -> list[tuple[int, dict]]:
    """Rows keyed by the spreadsheet row number (the header is row 1)."""
    try:
        text = content.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ValueError('The CSV file must be UTF-8 text. In Excel, use "Save as → CSV UTF-8".')
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise ValueError('The CSV file is empty.')
    header = [h.strip().lower().replace(' ', '_') for h in header]
    unknown = [h for h in header if h and h not in COLUMNS]
    missing = [h for h in REQUIRED_COLUMNS if h not in header]
    if unknown or missing:
        parts = []
        if missing: parts.append('missing column(s): ' + ', '.join(missing))
        if unknown: parts.append('unknown column(s): ' + ', '.join(unknown))
        raise ValueError('The CSV header has ' + '; '.join(parts) + '. Expected: ' + ', '.join(COLUMNS) + '.')
    if len(set(header)) != len(header):
        raise ValueError('The CSV header repeats a column.')
    rows = []
    for line_number, values in enumerate(reader, start=2):
        if not any(v.strip() for v in values):
            continue  # skip blank lines, common at the end of exported files
        if len(values) > len(header):
            raise ValueError(f'Row {line_number} has more values than the header has columns.')
        rows.append((line_number, {h: v for h, v in zip(header, values) if h}))
    if not rows:
        raise ValueError('The CSV file has a header but no purchase orders.')
    return rows


def template_csv(refs: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(COLUMNS)
    vendor = (refs.get('vendors') or [{}])[0]
    writer.writerow(['PO-EXAMPLE-001', vendor.get('id', 'V001'), vendor.get('currency', 'USD'),
                     '1500.00', '1500.00', '0', '2', date.today().isoformat()])
    return out.getvalue()
