import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { CaseDetail } from '@/api/types';
import { setReviewerName } from '@/lib/reviewerName';
import { caseDetail } from '@/test/fixtures';
import { ComparePanel } from './ComparePanel';

const snapshot = {
  vendors: [{ id: 'V001', name: 'Northstar Office Supplies', approved: true, bank_account: 'DEMO-ACCOUNT-001', payment_terms: 'Net 30' }],
  purchase_orders: [
    { number: 'PO-26001', vendor_id: 'V001', amount: 500, received_amount: 500, previously_invoiced: 0, currency: 'USD', issue_date: '2026-10-01' },
    { number: 'PO-26099', vendor_id: 'V001', amount: 900, received_amount: 900, previously_invoiced: 0, currency: 'USD', issue_date: '2026-10-05' },
  ],
};

function renderPanel(overrides: Partial<CaseDetail>) {
  const detail = caseDetail({ policy_snapshot: snapshot, ...overrides } as Partial<CaseDetail>);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ComparePanel detail={detail} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return detail;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); setReviewerName(''); });

describe('ComparePanel', () => {
  it('shows the matched PO next to the invoice', () => {
    renderPanel({ checks: { po_match: { balance: '500.00', received_balance: '500.00' } } } as Partial<CaseDetail>);
    expect(screen.getByText('PO-26001')).toBeTruthy();
    expect(screen.getByText('Available for this invoice')).toBeTruthy();
    expect(screen.getByTitle('Invoice PDF')).toBeTruthy();
  });

  it('says the PO was not found and lets the reviewer pick one of the vendor\'s POs', () => {
    const e = caseDetail().extraction as { po_reference: { value: string } };
    e.po_reference.value = 'PO-2600l';
    renderPanel({
      po_number: null,
      extraction: e as never,
      findings: [{ code: 'UNKNOWN_PO', message: 'Unknown PO', stage: 'po_identification', field: 'po_reference' }],
      decision: { outcome: 'review', reason_codes: ['UNKNOWN_PO'], explanation: 'Unknown PO', manual_override: false },
    } as Partial<CaseDetail>);
    expect(screen.getByText('Purchase order not found')).toBeTruthy();
    expect(screen.getByText(/No purchase order called “PO-2600l”/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Use this PO' })[1]);
    expect(screen.getByText('PO reference set to PO-26099')).toBeTruthy();
    expect((screen.getByDisplayValue('PO-26099') as HTMLInputElement).value).toBe('PO-26099');
  });

  it('only approves manually once every issue is ticked, a note is given and the reviewer confirms', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(caseDetail({ status: 'approved' })));
    const detail = renderPanel({
      findings: [
        { code: 'BANK_ACCOUNT_CHANGED', message: 'x', stage: 'vendor_check', field: null },
        { code: 'TOTAL_MISMATCH', message: 'y', stage: 'validation', field: null },
      ],
      decision: { outcome: 'review', reason_codes: ['BANK_ACCOUNT_CHANGED', 'TOTAL_MISMATCH'], explanation: 'x', manual_override: false },
    } as Partial<CaseDetail>);
    fireEvent.click(screen.getByRole('radio', { name: /Approve manually/ }));
    const approve = screen.getByRole('button', { name: 'Approve manually' }) as HTMLButtonElement;
    expect(screen.getByText('1 high-risk issue')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Called the vendor/), { target: { value: 'Confirmed with vendor by phone' } });
    fireEvent.click(screen.getByLabelText(/compared this invoice/));
    fireEvent.click(screen.getByLabelText(/Bank account doesn't match/));
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Totals don't add up/));
    expect(approve.disabled).toBe(true); // still needs the reviewer's name
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Priya Sharma' } });
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain(`/api/v1/cases/${detail.id}/approve`);
    expect(JSON.parse(String(init?.body))).toEqual({
      expected_version: detail.version, note: 'Confirmed with vendor by phone', reviewer: 'Priya Sharma',
      acknowledged_codes: ['BANK_ACCOUNT_CHANGED', 'TOTAL_MISMATCH'],
    });
    expect(init?.headers as Record<string, string>).not.toHaveProperty('X-Reviewer-Key');
  });

  it('offers retry instead of manual approval when nothing could be read', () => {
    renderPanel({
      extraction: null,
      findings: [{ code: 'PROCESSING_ERROR', message: 'down', stage: 'extraction', field: null }],
      decision: { outcome: 'review', reason_codes: ['PROCESSING_ERROR'], explanation: 'down', manual_override: false },
    } as Partial<CaseDetail>);
    expect(screen.queryByRole('radio', { name: /Approve manually/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry processing' })).toBeTruthy();
  });
});
