import { describe, expect, it } from 'vitest';
import type { CaseDetail } from '@/api/types';
import { caseDetail } from '@/test/fixtures';
import { approvalChecklist, comparisonRows, explain, fieldLabel, issuesFor, productSummary, referencesFor } from './insights';

const snapshot = {
  vendors: [{ id: 'V001', name: 'Northstar Office Supplies', approved: true, bank_account: 'DEMO-ACCOUNT-001', payment_terms: 'Net 30' }],
  purchase_orders: [{ number: 'PO-26001', vendor_id: 'V001', amount: 500, received_amount: 400, previously_invoiced: 100, currency: 'USD', issue_date: '2026-10-01' }],
};

function withFindings(findings: CaseDetail['findings'], extra: Partial<CaseDetail> = {}) {
  return caseDetail({ findings, policy_snapshot: snapshot, ...extra } as Partial<CaseDetail>);
}

describe('case insights', () => {
  it('finds the vendor and PO records the decision used', () => {
    const { vendor, po } = referencesFor(withFindings([]));
    expect(vendor?.name).toBe('Northstar Office Supplies');
    expect(po?.number).toBe('PO-26001');
  });

  it('never borrows the vendor from the PO when the backend matched none', () => {
    const { vendor, po } = referencesFor(withFindings(
      [{ code: 'UNAPPROVED_VENDOR', message: 'x', stage: 'vendor_check', field: null }], { vendor_id: null } as Partial<CaseDetail>));
    expect(po?.number).toBe('PO-26001');
    expect(vendor).toBeNull();
  });

  it('explains findings in plain language, including field-specific ones', () => {
    expect(explain({ code: 'BANK_ACCOUNT_CHANGED', message: 'x', stage: 'vendor', field: null })).toMatchObject({
      title: "Bank account doesn't match our records", severity: 'high',
    });
    expect(explain({ code: 'EVIDENCE_NOT_FOUND', message: 'x', stage: 'validation', field: 'line_items.0.amount' }).title)
      .toBe("Couldn't confirm line 1 amount on the document");
    expect(explain({ code: 'missing_fx_rate', message: 'x', stage: 'fx', field: null }).title).toBe('No approved exchange rate');
    expect(explain({ code: 'MISSING_DUE_DATE', message: 'x', stage: 'validation', field: null }).title).toBe('Due date is missing');
    expect(explain({ code: 'SOMETHING_NEW', message: 'Backend message', stage: 's', field: null }).why).toBe('Backend message');
  });

  it('groups repeated findings and puts high-risk issues first', () => {
    const issues = issuesFor([
      { code: 'NEGATIVE_AMOUNT', message: 'a', stage: 's', field: null },
      { code: 'NEGATIVE_AMOUNT', message: 'b', stage: 's', field: null },
      { code: 'UNAPPROVED_VENDOR', message: 'c', stage: 's', field: null },
    ]);
    expect(issues.map((i) => [i.code, i.count])).toEqual([['UNAPPROVED_VENDOR', 1], ['NEGATIVE_AMOUNT', 2]]);
  });

  it('puts invoice and PO values side by side and marks the row a finding belongs to', () => {
    const rows = comparisonRows(withFindings([{ code: 'BANK_ACCOUNT_CHANGED', message: 'x', stage: 'vendor', field: null }]),
      ...Object.values(referencesFor(withFindings([]))) as [never, never]);
    const bank = rows.find((r) => r.id === 'bank')!;
    expect(bank).toMatchObject({ invoice: 'DEMO-ACCOUNT-001', reference: 'DEMO-ACCOUNT-001', status: 'issue' });
    const amount = rows.find((r) => r.id === 'amount')!;
    expect(amount.invoice).toBe('USD 281.60');
    expect(amount.reference).toBe('USD 400.00 available');
    expect(amount.status).toBe('ok');
    expect(rows.find((r) => r.id === 'received')!.reference).toBe('USD 300.00 not yet billed');
  });

  it('prefers the backend PO balance over the snapshot arithmetic', () => {
    const detail = withFindings([], { checks: { po_match: { balance: '123.45', received_balance: '50' } } } as Partial<CaseDetail>);
    const { vendor, po } = referencesFor(detail);
    expect(comparisonRows(detail, vendor, po).find((r) => r.id === 'amount')!.reference).toBe('USD 123.45 available');
  });

  it('lists what an approved invoice passed', () => {
    const detail = withFindings([], { status: 'approved' } as Partial<CaseDetail>);
    const { vendor, po } = referencesFor(detail);
    const labels = approvalChecklist(detail, vendor, po).map((c) => c.label);
    expect(labels).toContain('Bank account verified');
    expect(labels).toContain('Within PO budget');
  });

  it('labels fields and summarises products', () => {
    expect(fieldLabel('total_amount')).toBe('Total amount');
    expect(fieldLabel('line_items.1.unit_price')).toBe('Line 2 unit price');
    expect(productSummary(caseDetail().extraction as never)).toBe('Paper');
  });
});
