/** Formatting helpers. Amounts are decimal strings from the backend and are never converted to floats. */

export function formatAmount(value: string | number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const str = String(value);
  const [intPart, frac] = str.split('.');
  const negative = intPart.startsWith('-');
  const digits = negative ? intPart.slice(1) : intPart;
  if (!/^\d+$/.test(digits) || (frac !== undefined && !/^\d+$/.test(frac))) {
    return currency ? `${currency} ${str}` : str;
  }
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (frac ?? '').padEnd(2, '0');
  const out = `${negative ? '-' : ''}${grouped}.${fraction}`;
  return currency ? `${currency} ${out}` : out;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function humanize(key: string): string {
  const s = key.replace(/[_.]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
