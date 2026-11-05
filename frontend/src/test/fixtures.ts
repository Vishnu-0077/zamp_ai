import type { CaseDetail, ExtractedField, InvoiceExtraction } from '@/api/types';

const f = <T = string>(value: T | null, confidence: 'high' | 'medium' | 'low' = 'high'): ExtractedField<T> => ({
  value, confidence, evidence: value == null ? null : String(value), page: value == null ? null : 1,
});

export function extraction(): InvoiceExtraction {
  return {
    document_type: f('invoice'),
    original_invoice: f(null),
    vendor_name: f('Northstar Office Supplies'),
    invoice_number: f('001-2026-0001'),
    invoice_date: f('2026-10-14'),
    due_date: f('2026-11-13'),
    currency: f('USD'),
    po_reference: f('PO-26001'),
    line_items: [
      { description: f('Paper'), quantity: f('2'), unit_price: f('140.80'), amount: f('281.60') },
    ],
    subtotal: f('281.60'),
    tax: f('0.00'),
    total_amount: f('281.60', 'medium'),
    bank_details: f('DEMO-ACCOUNT-001'),
    tax_profile: f(null),
    tax_rate: f(null),
    supplier_state: f(null),
    place_of_supply: f(null),
    tax_components: { value: null, confidence: 'high', evidence: null, page: null },
  } as unknown as InvoiceExtraction;
}

export function caseDetail(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    email_id: 1,
    hash: 'a'.repeat(64),
    sender: 'billing@northstar.example',
    filename: 'invoice.pdf',
    status: 'review',
    version: 3,
    created_at: '2026-11-02T10:00:00+00:00',
    updated_at: '2026-11-02T10:01:00+00:00',
    findings: [{ code: 'LOW_CONFIDENCE', message: 'Total is low confidence', stage: 'validation', field: 'total_amount' }],
    decision: { outcome: 'review', reason_codes: ['LOW_CONFIDENCE'], explanation: 'Total is low confidence' },
    po_number: 'PO-26001',
    vendor_id: 'V001',
    invoice_number: '001-2026-0001',
    amount: '281.60',
    currency: 'USD',
    invoice_date: '2026-10-14',
    model: 'test-model',
    pages: [{ page: 1, text: 'Invoice', route: 'digital', ocr_confidence: null }],
    extraction: extraction(),
    checks: { rule_version: 'x' },
    policy_snapshot: null,
    ...overrides,
  } as CaseDetail;
}
