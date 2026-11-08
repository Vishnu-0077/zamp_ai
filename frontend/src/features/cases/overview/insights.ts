/**
 * Turns a case into human-readable insights for the overview screen.
 *
 * The backend makes every decision; nothing here re-runs business rules. These
 * helpers only (1) find the vendor and PO records the decision used, (2) explain
 * each finding in plain language, and (3) attribute findings to comparison rows.
 */
import type { CaseDetail, ExtractedField, Finding, InvoiceExtraction, PurchaseOrder, Vendor } from '@/api/types';
import { formatAmount, humanize } from '@/lib/format';
import { FIELD_GROUPS, LINE_ITEM_FIELDS } from '../fieldConfig';
import { isSingleInvoice } from '../correction';

export type RowStatus = 'ok' | 'issue' | 'missing' | 'info';
export type Severity = 'high' | 'medium';

interface Snapshot {
  vendors?: Vendor[];
  purchase_orders?: PurchaseOrder[];
}

/** The single invoice on a case, or null for bundles / missing extraction. */
export function invoiceOf(detail: CaseDetail): InvoiceExtraction | null {
  return isSingleInvoice(detail.extraction) ? detail.extraction : null;
}

function value<T = string>(field: unknown): T | null {
  const f = field as ExtractedField<T> | undefined;
  return f && f.value !== undefined ? f.value : null;
}

const PO_PROBLEMS = new Set(['UNKNOWN_PO', 'AMBIGUOUS_PO', 'PO_VENDOR_MISMATCH', 'MISSING_PO', 'MISSING_PO_REFERENCE']);

/** Vendor and PO records the decision was made against (from the policy snapshot). */
export function referencesFor(detail: CaseDetail): { vendor: Vendor | null; po: PurchaseOrder | null } {
  const snapshot = (detail.policy_snapshot ?? {}) as Snapshot;
  const invoice = invoiceOf(detail);
  const checks = (detail.checks ?? {}) as Record<string, unknown>;
  const candidates = Array.isArray(checks.po_candidates) ? (checks.po_candidates as string[]) : [];
  // When the backend couldn't attach a PO, never present the printed number as matched.
  const poRejected = detail.findings.some((f) => PO_PROBLEMS.has(f.code.toUpperCase()));
  const poNumber = detail.po_number
    ?? (poRejected ? null : (candidates.length === 1 ? candidates[0] : null) ?? value<string>(invoice?.po_reference));
  const po = snapshot.purchase_orders?.find((p) => p.number === poNumber) ?? null;
  // Only the vendor the backend matched. Never borrow the PO's vendor: an unknown
  // sender quoting someone else's PO number is exactly what must stay visible.
  const vendor = snapshot.vendors?.find((v) => v.id === detail.vendor_id) ?? null;
  return { vendor, po };
}

/** The vendor a purchase order was raised for (may differ from the invoice's sender). */
export function vendorOfPo(detail: CaseDetail, po: PurchaseOrder | null): Vendor | null {
  const snapshot = (detail.policy_snapshot ?? {}) as Snapshot;
  return po ? snapshot.vendors?.find((v) => v.id === po.vendor_id) ?? null : null;
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label])),
);

/** "line_items.0.amount" -> "Line 1 amount"; "total_amount" -> "Total amount". */
export function fieldLabel(field: string | null | undefined): string {
  if (!field) return 'A value';
  const line = /^line_items\.(\d+)\.(\w+)$/.exec(field);
  if (line) {
    const label = LINE_ITEM_FIELDS.find((f) => f.key === line[2])?.label ?? humanize(line[2]);
    return `Line ${Number(line[1]) + 1} ${label.toLowerCase()}`;
  }
  if (field === 'tax_components') return 'Tax breakdown';
  return FIELD_LABELS[field] ?? humanize(field);
}

export interface Explanation {
  title: string;
  why: string;
  action: string;
  severity: Severity;
}

type Explainer = (field: string) => Omit<Explanation, 'severity'> & { severity?: Severity };

const READ_FAILURE: Explainer = () => ({
  title: "We couldn't read this invoice automatically",
  why: 'Reading the PDF or extracting its data failed, so no business checks could run yet.',
  action: 'Use “Retry processing” once the problem is fixed, or correct the data by hand from the PDF.',
});

/** Plain-language explanations, keyed by upper-cased finding code. */
const EXPLAIN: Record<string, Explainer> = {
  UNAPPROVED_VENDOR: () => ({
    title: "Vendor isn't on the approved list",
    why: "The supplier name on the invoice doesn't match any approved vendor.",
    action: "Check the supplier name on the PDF. If it's a new supplier, they must be onboarded before payment.",
    severity: 'high',
  }),
  BANK_ACCOUNT_CHANGED: () => ({
    title: "Bank account doesn't match our records",
    why: 'The invoice asks for payment to a different account than the one on file. This is a common fraud pattern.',
    action: 'Confirm the change with the vendor using contact details you already have, not the ones on this invoice.',
    severity: 'high',
  }),
  MISSING_BANK_ACCOUNT: () => ({
    title: 'No bank account on the invoice',
    why: "We can't confirm where the payment would go.",
    action: 'Check the PDF for payment details, or ask the vendor for a corrected invoice.',
  }),
  MISSING_PO: () => ({ title: 'No PO number on the invoice', why: 'Every invoice must reference a purchase order.', action: 'Ask the requester or vendor which PO this invoice is for.' }),
  MISSING_PO_REFERENCE: () => ({ title: 'No PO number on the invoice', why: 'Every invoice must reference a purchase order.', action: 'Ask the requester or vendor which PO this invoice is for.' }),
  UNKNOWN_PO: () => ({
    title: 'PO number not found',
    why: "The PO number on the invoice doesn't exist in our purchasing records.",
    action: 'Check the PO on the PDF for typos, or ask the requester for the right PO.',
  }),
  AMBIGUOUS_PO: () => ({ title: 'More than one PO could match', why: "We couldn't tell which purchase order this invoice belongs to.", action: 'Pick the right PO with the requester and correct the PO number.' }),
  PO_VENDOR_MISMATCH: () => ({
    title: 'PO belongs to a different vendor',
    why: 'The PO on this invoice was raised for another supplier.',
    action: 'Confirm the PO number with the requester before paying.',
    severity: 'high',
  }),
  PO_BALANCE_EXCEEDED: () => ({
    title: "Invoice is more than what's left on the PO",
    why: 'Paying this would spend more than the purchase order allows.',
    action: 'Ask the requester to increase the PO, or ask the vendor to correct the amount.',
    severity: 'high',
  }),
  CONVERTED_PO_OVERRUN: () => ({
    title: "Invoice is more than what's left on the PO (after currency conversion)",
    why: 'Converted into the PO currency, the invoice exceeds the remaining PO balance.',
    action: 'Check the exchange rate and amount, then raise the PO or ask for a corrected invoice.',
    severity: 'high',
  }),
  RECEIPT_BALANCE_EXCEEDED: () => ({
    title: 'Billed for more than was received',
    why: 'The invoice is for more goods or services than have been recorded as received.',
    action: 'Check with the receiving team that everything billed actually arrived.',
    severity: 'high',
  }),
  TOTAL_MISMATCH: () => ({ title: "Totals don't add up", why: "Subtotal plus tax doesn't equal the total printed on the invoice.", action: 'Check the totals on the PDF. If the invoice itself is wrong, ask the vendor for a corrected one.' }),
  SUBTOTAL_MISMATCH: () => ({ title: "Line items don't add up to the subtotal", why: 'The sum of the line amounts differs from the printed subtotal.', action: 'Compare each line with the PDF; ask the vendor to correct the invoice if it is wrong.' }),
  LINE_MATH_MISMATCH: (f) => ({ title: 'Quantity × price ≠ line amount', why: `${fieldLabel(f)}: the quantity times the unit price doesn't equal the line amount.`, action: 'Check the line on the PDF; a misread digit is common on scans.' }),
  DUPLICATE_INVOICE: () => ({ title: 'This invoice was already processed', why: 'The same vendor and invoice number were already approved.', action: 'Do not pay again. Check the earlier case.', severity: 'high' }),
  POSSIBLE_DUPLICATE: () => ({ title: 'Looks like another invoice', why: 'Another case from this vendor has the same or a very similar invoice number or amount.', action: 'Open the other case and make sure this is not the same bill sent twice.', severity: 'high' }),
  NEGATIVE_AMOUNT: () => ({ title: 'Negative amount', why: 'The invoice contains a negative value, which usually means a credit.', action: 'Confirm whether this is a credit note and handle it as an adjustment.' }),
  NEGATIVE_INVOICE: () => ({ title: 'Negative invoice total', why: 'An invoice should not have a negative total.', action: 'Confirm whether this is really a credit note.' }),
  ZERO_TOTAL: () => ({ title: 'Total is zero', why: 'There is nothing to pay on this invoice.', action: 'Check the PDF; it may be a statement or a misread total.' }),
  ADJUSTMENT_DOCUMENT: () => ({ title: 'This is a credit or debit note', why: 'Credit and debit notes change an earlier invoice, so they always need a person to check them.', action: 'Find the original invoice and confirm the adjustment is expected.' }),
  MISSING_ORIGINAL_INVOICE: () => ({ title: 'Original invoice not referenced', why: "This adjustment doesn't say which invoice it changes.", action: 'Ask the vendor which invoice this note applies to.' }),
  UNKNOWN_DOCUMENT_TYPE: () => ({ title: 'Unclear document type', why: "We couldn't tell whether this is an invoice, credit note or debit note.", action: 'Check the title on the PDF and set the document type.' }),
  OLD_INVOICE: () => ({ title: 'Invoice is very old', why: 'It is older than the allowed invoice age in the payment policy.', action: 'Check with the vendor whether it is still due and was not paid before.' }),
  FUTURE_INVOICE_DATE: () => ({ title: 'Invoice is dated in the future', why: 'The invoice date is after today.', action: 'Check the date on the PDF; it may be misread or post-dated.' }),
  INVOICE_BEFORE_PO: () => ({ title: 'Invoice is dated before the PO', why: 'The work was billed before it was ordered.', action: 'Confirm with the requester that this purchase was approved.' }),
  DUE_BEFORE_INVOICE: () => ({ title: 'Due date is before the invoice date', why: "The dates can't both be right.", action: 'Check both dates on the PDF and correct the one that was misread.' }),
  INVALID_DATE: (f) => ({ title: `${fieldLabel(f)} isn't a valid date`, why: "The date couldn't be understood.", action: 'Read the date on the PDF and correct it.' }),
  DATE_EVIDENCE_AMBIGUOUS: (f) => ({ title: `${fieldLabel(f)} is ambiguous`, why: 'The printed date could be read more than one way (for example 03/04 as March 4 or 3 April).', action: 'Confirm the date format with the vendor and correct it.' }),
  MISSING_FX_RATE: () => ({ title: 'No approved exchange rate', why: "The invoice currency differs from the PO and there's no approved rate for that date.", action: 'Ask treasury to approve a rate for the invoice date.' }),
  INVALID_CURRENCY: () => ({ title: 'Currency not recognised', why: 'The currency should be a three-letter code such as USD.', action: 'Read the currency on the PDF and correct it.' }),
  GST_COMPONENT_AMOUNT: () => ({ title: "Tax breakdown doesn't add up", why: "A tax component's amount doesn't match its rate.", action: 'Check the tax lines on the PDF.' }),
  GST_COMPONENT_TYPE: () => ({ title: 'Wrong type of tax for this supply', why: "The tax types don't fit the supplier's and buyer's locations.", action: 'Check the tax lines and the place of supply on the PDF.' }),
  GST_SPLIT_TOTAL: () => ({ title: "Tax breakdown doesn't add up", why: "The tax components don't add up to the total tax.", action: 'Check the tax lines on the PDF.' }),
  MISSING_LINE_ITEMS: () => ({ title: 'No line items found', why: "We couldn't find what was bought on the invoice.", action: 'Check the PDF and add the line items.' }),
  MULTIPLE_DOCUMENTS: () => ({ title: 'PDF contains several documents', why: 'More than one invoice or note is bundled in one file.', action: 'Split the PDF and upload each document separately.' }),
  EVIDENCE_NOT_FOUND: (f) => ({ title: `Couldn't confirm ${fieldLabel(f).toLowerCase()} on the document`, why: `The value read for ${fieldLabel(f).toLowerCase()} couldn't be found on the page, so it may be misread.`, action: `Compare ${fieldLabel(f).toLowerCase()} with the PDF and correct it if needed.` }),
  VALUE_NOT_SUPPORTED: (f) => ({ title: `${fieldLabel(f)} doesn't match the document`, why: `The value read for ${fieldLabel(f).toLowerCase()} differs from the text it was read from.`, action: `Check ${fieldLabel(f).toLowerCase()} on the PDF and correct it.` }),
  LOW_FIELD_CONFIDENCE: (f) => ({ title: `Unsure about ${fieldLabel(f).toLowerCase()}`, why: 'The value was hard to read with certainty.', action: `Check ${fieldLabel(f).toLowerCase()} on the PDF.` }),
  LOW_OCR_CONFIDENCE: () => ({ title: 'The scan is hard to read', why: 'The document is a low-quality scan, so values may be misread.', action: 'Compare the key amounts and numbers with the PDF.' }),
  OCR_UNAVAILABLE: READ_FAILURE,
  OCR_FAILED: READ_FAILURE,
  EXTRACTION_NOT_CONFIGURED: READ_FAILURE,
  EXTRACTION_SCHEMA_FAILED: READ_FAILURE,
  PROCESSING_ERROR: READ_FAILURE,
};

/** Explain one finding in plain language; unknown codes fall back to the backend message. */
export function explain(finding: Finding): Explanation {
  const code = finding.code.toUpperCase();
  const field = finding.field ?? '';
  const explainer = EXPLAIN[code];
  if (explainer) return { severity: 'medium', ...explainer(field) };
  if (code.startsWith('MISSING_')) {
    const name = code.slice('MISSING_'.length).toLowerCase();
    const missing = field ? fieldLabel(field) : name === 'number' ? 'Invoice number' : fieldLabel(name);
    return { title: `${missing} is missing`, why: `We couldn't find ${missing.toLowerCase()} on the invoice.`, action: 'Check the PDF and add it if it is printed there.', severity: 'medium' };
  }
  return { title: humanize(finding.code.toLowerCase()), why: finding.message, action: 'Check this against the PDF.', severity: 'medium' };
}

export interface Issue extends Explanation {
  code: string;
  field: string | null;
  count: number;
}

/** Findings grouped by code + field, high severity first. */
export function issuesFor(findings: Finding[]): Issue[] {
  const grouped = new Map<string, Issue>();
  for (const f of findings) {
    // Group by what the reviewer reads: two codes for the same problem show once.
    const key = explain(f).title;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { ...explain(f), code: f.code.toUpperCase(), field: f.field ?? null, count: 1 });
  }
  return [...grouped.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

export interface ComparisonRow {
  id: string;
  label: string;
  invoice: string;
  reference: string;
  referenceNote?: string;
  status: RowStatus;
  issues: Issue[];
}

/** Which comparison row each finding belongs to. */
const ROW_CODES: Record<string, string[]> = {
  vendor: ['UNAPPROVED_VENDOR'],
  po: ['MISSING_PO', 'MISSING_PO_REFERENCE', 'UNKNOWN_PO', 'AMBIGUOUS_PO', 'PO_VENDOR_MISMATCH'],
  currency: ['INVALID_CURRENCY', 'MISSING_FX_RATE'],
  amount: ['PO_BALANCE_EXCEEDED', 'CONVERTED_PO_OVERRUN', 'TOTAL_MISMATCH', 'ZERO_TOTAL', 'NEGATIVE_INVOICE'],
  received: ['RECEIPT_BALANCE_EXCEEDED'],
  bank: ['BANK_ACCOUNT_CHANGED', 'MISSING_BANK_ACCOUNT'],
  date: ['INVOICE_BEFORE_PO', 'FUTURE_INVOICE_DATE', 'OLD_INVOICE'],
  terms: ['DUE_BEFORE_INVOICE'],
};
const ROW_FIELDS: Record<string, string[]> = {
  vendor: ['vendor_name'],
  po: ['po_reference'],
  currency: ['currency'],
  amount: ['total_amount'],
  bank: ['bank_details'],
  date: ['invoice_date'],
  terms: ['due_date'],
};

function money(amount: unknown, currency?: string | null): string {
  return amount === null || amount === undefined || amount === '' ? '—' : formatAmount(String(amount), currency);
}

function minus(a: unknown, b: unknown): string | null {
  // Display-only arithmetic on 2-decimal money values, done in integer cents.
  const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  if (a === null || a === undefined || Number.isNaN(Number(a)) || Number.isNaN(Number(b ?? 0))) return null;
  return ((cents(a) - cents(b)) / 100).toFixed(2);
}

/** Side-by-side invoice vs PO / vendor-record rows, with the findings that apply to each. */
export function comparisonRows(detail: CaseDetail, vendor: Vendor | null, po: PurchaseOrder | null): ComparisonRow[] {
  const invoice = invoiceOf(detail);
  const issues = issuesFor(detail.findings);
  const checks = (detail.checks ?? {}) as Record<string, unknown>;
  const match = (checks.po_match ?? {}) as Record<string, unknown>;
  const currency = value<string>(invoice?.currency) ?? detail.currency;
  const poCurrency = po?.currency ?? null;
  const remaining = match.balance ?? (po ? minus(po.amount, po.previously_invoiced) : null);
  const receivedLeft = match.received_balance ?? (po?.received_amount !== undefined ? minus(po.received_amount, po.previously_invoiced) : null);

  const rows: Omit<ComparisonRow, 'status' | 'issues'>[] = [
    {
      id: 'vendor', label: 'Vendor',
      invoice: value<string>(invoice?.vendor_name) ?? '—',
      reference: vendor ? vendor.name : '—',
      referenceNote: vendor ? `${vendor.id}${vendor.approved === false ? ' · not approved' : ' · approved vendor'}` : 'No matching vendor record',
    },
    {
      id: 'po', label: 'Purchase order',
      invoice: value<string>(invoice?.po_reference) ?? '—',
      reference: po?.number ?? '—',
      referenceNote: po ? `Issued ${po.issue_date ?? '—'}` : 'No matching PO',
    },
    { id: 'currency', label: 'Currency', invoice: currency ?? '—', reference: poCurrency ?? '—' },
    {
      id: 'amount', label: 'Amount',
      invoice: money(value(invoice?.total_amount) ?? detail.amount, currency),
      reference: po ? `${money(remaining, poCurrency)} available` : '—',
      referenceNote: po ? `Before this invoice · PO total ${money(po.amount, poCurrency)} · already invoiced ${money(po.previously_invoiced ?? 0, poCurrency)}` : undefined,
    },
    {
      id: 'received', label: 'Goods / services received',
      invoice: money(value(invoice?.total_amount) ?? detail.amount, currency),
      reference: po && receivedLeft !== null ? `${money(receivedLeft, poCurrency)} not yet billed` : '—',
      referenceNote: po?.received_amount !== undefined ? `Received to date ${money(po.received_amount, poCurrency)}` : undefined,
    },
    { id: 'bank', label: 'Bank account', invoice: value<string>(invoice?.bank_details) ?? '—', reference: vendor?.bank_account ?? '—', referenceNote: vendor ? 'On the vendor record' : undefined },
    { id: 'date', label: 'Invoice date', invoice: value<string>(invoice?.invoice_date) ?? detail.invoice_date ?? '—', reference: po?.issue_date ?? '—', referenceNote: po ? 'PO issue date' : undefined },
    { id: 'terms', label: 'Due date / terms', invoice: value<string>(invoice?.due_date) ?? '—', reference: vendor?.payment_terms ?? '—', referenceNote: vendor?.payment_terms ? 'Agreed payment terms' : undefined },
  ];

  return rows.map((row) => {
    const rowIssues = issues.filter((i) => ROW_CODES[row.id]?.includes(i.code) || (i.field !== null && ROW_FIELDS[row.id]?.includes(i.field)));
    const status: RowStatus = rowIssues.length ? 'issue' : row.invoice === '—' || row.reference === '—' ? 'missing' : 'ok';
    return { ...row, status, issues: rowIssues };
  });
}

export interface PassedCheck {
  label: string;
  detail: string;
}

/** What an approved case passed, phrased for a person. Only meaningful when status is approved. */
export function approvalChecklist(detail: CaseDetail, vendor: Vendor | null, po: PurchaseOrder | null): PassedCheck[] {
  const invoice = invoiceOf(detail);
  const checks = (detail.checks ?? {}) as Record<string, { status?: string } | unknown>;
  const traced = Object.values(checks).filter((c) => c && typeof c === 'object' && (c as { status?: string }).status === 'passed').length;
  const match = ((checks as Record<string, unknown>).po_match ?? {}) as Record<string, unknown>;
  const currency = value<string>(invoice?.currency) ?? detail.currency;
  const total = money(value(invoice?.total_amount) ?? detail.amount, currency);
  return [
    { label: 'Approved vendor', detail: vendor ? `${vendor.name} is on the approved vendor list.` : 'The supplier is on the approved vendor list.' },
    { label: 'Bank account verified', detail: vendor?.bank_account ? `Payment goes to ${vendor.bank_account}, the account on the vendor record.` : 'Bank details match the vendor record.' },
    { label: 'Matched to purchase order', detail: po ? `${po.number} was raised for this vendor on ${po.issue_date ?? '—'}.` : 'The invoice matches a purchase order for this vendor.' },
    { label: 'Within PO budget', detail: match.balance !== undefined ? `${total} fits within the ${money(match.balance, po?.currency)} left on the PO.` : `${total} fits within the remaining PO balance.` },
    { label: 'Goods received', detail: 'The amount is covered by goods or services recorded as received.' },
    { label: 'Totals add up', detail: 'Line items, subtotal, tax and total are consistent.' },
    { label: 'Not a duplicate', detail: 'No earlier invoice from this vendor has the same number.' },
    { label: 'Dates are valid', detail: 'The invoice date is after the PO and within the allowed age.' },
    { label: 'Read accurately', detail: traced ? `All ${traced} values were found word-for-word on the document.` : 'Every value was found on the document.' },
  ];
}

/** Short "what was bought" summary from the line items. */
export function productSummary(invoice: InvoiceExtraction | null): string | null {
  const lines = invoice?.line_items ?? [];
  const first = lines.map((l) => value<string>(l.description)).find(Boolean);
  if (!first) return null;
  return lines.length > 1 ? `${first} + ${lines.length - 1} more item${lines.length > 2 ? 's' : ''}` : first;
}

/** Why the PO couldn't be matched, in plain language, or null when it was found. */
export function poProblem(detail: CaseDetail): string | null {
  if (referencesFor(detail).po) return null;
  const ref = value<string>(invoiceOf(detail)?.po_reference);
  const codes = new Set(detail.findings.map((f) => f.code.toUpperCase()));
  if (!ref) return 'The invoice does not mention a purchase order number.';
  if (codes.has('AMBIGUOUS_PO')) return `“${ref}” could match more than one purchase order.`;
  if (codes.has('PO_VENDOR_MISMATCH')) return `${ref} exists but belongs to a different vendor.`;
  return `No purchase order called “${ref}” exists in our records.`;
}

export interface PoOption {
  po: PurchaseOrder;
  available: string | null;
}

/** The vendor's purchase orders, to pick the right one when the invoice's PO wasn't found. */
export function vendorPurchaseOrders(detail: CaseDetail): { vendor: Vendor | null; options: PoOption[] } {
  const snapshot = (detail.policy_snapshot ?? {}) as Snapshot;
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = norm(value<string>(invoiceOf(detail)?.vendor_name));
  const vendor = referencesFor(detail).vendor
    ?? snapshot.vendors?.find((v) => [v.name, ...((v.aliases as string[] | undefined) ?? [])].some((n) => name && norm(n) === name))
    ?? null;
  const options = (snapshot.purchase_orders ?? [])
    .filter((po) => vendor && po.vendor_id === vendor.id)
    .map((po) => ({ po, available: minus(po.amount, po.previously_invoiced) }));
  return { vendor, options };
}
