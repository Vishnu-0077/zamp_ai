import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { App } from '@/app/App';

const money = (amount: string) => [{ currency: 'USD', amount }];
const vendor = (over: Record<string, unknown>) => ({
  key: 'V1', vendor_id: 'V1', name: 'Acme', in_master: true, cases: 3, approved: 1, approved_manual: 0, review: 2, duplicate: 0,
  in_progress: 0, problem_cases: 2, problem_rate: 0.6667, approval_rate: 0.3333, problem_occurrences: 3,
  problems: [{ code: 'BANK_ACCOUNT_CHANGED', cases: 2 }, { code: 'TOTAL_MISMATCH', cases: 1 }],
  top_problems: ['BANK_ACCOUNT_CHANGED'], top_problem_cases: 2, approved_value: money('100.00'), ...over,
});
const statistics = {
  generated_at: '2026-11-09T05:00:00+00:00',
  totals: {
    cases: 5, by_status: { queued: 0, processing: 0, review: 3, approved: 2, duplicate: 0 }, finished: 5,
    approved_automatic: 1, approved_manual: 1, approval_rate: 0.4, straight_through_rate: 0.2,
    cases_with_problems: 4, cases_with_invoice_problems: 3, cases_with_processing_problems: 1, vendors: 3,
    approved_value: money('150.00'), held_value: money('300.00'),
  },
  vendors: [
    vendor({}),
    vendor({ key: 'V2', vendor_id: 'V2', name: 'Beta', cases: 1, approved: 1, approved_manual: 1, review: 0, problem_cases: 1, problem_rate: 1,
      problems: [{ code: 'TOTAL_MISMATCH', cases: 1 }], top_problems: ['TOTAL_MISMATCH'], top_problem_cases: 1 }),
    vendor({ key: 'unidentified', vendor_id: null, name: 'Vendor not identified', in_master: false, cases: 1, approved: 0, review: 1,
      problem_cases: 0, problem_rate: 0, problems: [], top_problems: [], top_problem_cases: 0, approved_value: [] }),
  ],
  problems: [
    { code: 'BANK_ACCOUNT_CHANGED', category: 'invoice', cases: 2, share_of_cases: 0.4, vendors: [{ key: 'V1', name: 'Acme', cases: 2 }], fields: [] },
    { code: 'TOTAL_MISMATCH', category: 'invoice', cases: 2, share_of_cases: 0.4,
      vendors: [{ key: 'V1', name: 'Acme', cases: 1 }, { key: 'V2', name: 'Beta', cases: 1 }], fields: [{ field: 'total_amount', cases: 1 }] },
    { code: 'PROCESSING_ERROR', category: 'processing', cases: 1, share_of_cases: 0.2, vendors: [{ key: 'unidentified', name: 'Vendor not identified', cases: 1 }], fields: [] },
  ],
  highlights: { most_problematic_vendors: ['V1'], most_common_problems: ['BANK_ACCOUNT_CHANGED', 'TOTAL_MISMATCH'] },
};

function mockBackend(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/v1/statistics') return Response.json(body);
    if (path === '/health') return Response.json({ status: 'ok', worker_enabled: true, worker_alive: true, extraction_configured: true });
    return Response.json({ items: [], total: 0, limit: 25, offset: 0, counts: {} });
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Statistics', () => {
  it('shows totals, the most problematic vendor, tied top problems and per-vendor problems', async () => {
    mockBackend(statistics);
    window.history.pushState({}, '', '/statistics');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Statistics' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Statistics' })).toBeTruthy(); // in the sidebar

    const worst = (await screen.findByRole('heading', { name: 'Most problematic vendor' })).closest('section')!;
    expect(within(worst).getByText('Acme')).toBeTruthy();
    expect(within(worst).getByText('2 of 3')).toBeTruthy();

    const common = screen.getByRole('heading', { name: 'Most common problems (tied)' }).closest('section')!;
    expect(within(common).getByText("Bank account doesn't match our records")).toBeTruthy();
    expect(within(common).getByText("Totals don't add up")).toBeTruthy();

    const table = screen.getByRole('heading', { name: 'Vendors' }).closest('section')!;
    expect(within(table).getByText('could not be read')).toBeTruthy();
    expect(within(table).getByText('1 (1 manual)')).toBeTruthy();

    expect(screen.getByText(/could not be read automatically \(PROCESSING_ERROR 1\)/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Approved automatically 1, Approved manually 1, Needs review 3/ })).toBeTruthy();
  });

  it('explains an empty system', async () => {
    mockBackend({ ...statistics, totals: { ...statistics.totals, cases: 0 }, vendors: [], problems: [],
      highlights: { most_problematic_vendors: [], most_common_problems: [] } });
    window.history.pushState({}, '', '/statistics');
    render(<App />);
    expect(await screen.findByText(/No cases yet/)).toBeTruthy();
  });
});
