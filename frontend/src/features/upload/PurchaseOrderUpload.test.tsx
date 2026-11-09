import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '@/app/App';
import { setReviewerName } from '@/lib/reviewerName';

const refs = {
  vendors: [{ id: 'V001', name: 'Northstar Office Supplies', approved: true, currency: 'USD' }],
  purchase_orders: [],
  fx_rates: [],
  policy: {},
};

function mockBackend(onPost: (path: string, url: URL, body: unknown) => unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    if (options?.method === 'POST') {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      return Response.json(onPost(url.pathname, url, body));
    }
    if (url.pathname === '/api/v1/references') return Response.json(refs);
    if (url.pathname === '/health') return Response.json({ status: 'ok', worker_enabled: true, worker_alive: true, extraction_configured: true });
    return Response.json({ items: [], total: 0, limit: 25, offset: 0, counts: {} });
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setReviewerName('');
});

describe('Upload PO', () => {
  it('shows both upload sections and saves a PO typed in the form', async () => {
    setReviewerName('Priya Sharma');
    let sent: { reviewer: string; items: Record<string, string>[] } | undefined;
    mockBackend((path, _url, body) => {
      expect(path).toBe('/api/v1/purchase-orders');
      sent = body as typeof sent;
      return { saved: true, valid: true, added: 1, rows: [{ row: 1, number: 'PO-9', errors: [] }] };
    });
    window.history.pushState({}, '', '/upload');
    render(<App />);
    expect(await screen.findByRole('tab', { name: 'Upload invoice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Upload PO' }));

    fireEvent.change(await screen.findByLabelText('PO number'), { target: { value: 'PO-9' } });
    await screen.findByRole('option', { name: /Northstar/ });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'V001' } });
    expect((screen.getByLabelText(/^Currency/) as HTMLInputElement).value).toBe('USD');
    fireEvent.change(screen.getByLabelText('PO amount'), { target: { value: '1500.00' } });
    fireEvent.change(screen.getByLabelText(/^Received amount/), { target: { value: '1500.00' } });
    fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase order' }));

    expect(await screen.findByText('PO-9 added')).toBeTruthy();
    expect(sent?.reviewer).toBe('Priya Sharma');
    expect(sent?.items[0]).toMatchObject({ number: 'PO-9', vendor_id: 'V001', currency: 'USD', amount: '1500.00', issue_date: '2026-11-01' });
    expect(window.location.search).toBe('?tab=po');
  });

  it('checks a CSV first and reports bad rows without saving', async () => {
    setReviewerName('Priya Sharma');
    const calls: string[] = [];
    mockBackend((path, url) => {
      expect(path).toBe('/api/v1/purchase-orders/csv');
      calls.push(url.searchParams.get('dry_run') ?? '');
      return { saved: false, valid: false, added: 0, rows: [
        { row: 2, number: 'PO-1', errors: [] },
        { row: 3, number: 'PO-2', errors: ['Unknown vendor ID "V9". Use an ID from Reference data → Vendors.'] },
      ] };
    });
    window.history.pushState({}, '', '/upload?tab=po');
    render(<App />);
    const template = await screen.findByRole('link', { name: 'Download template' });
    expect(template.getAttribute('href')).toBe('/api/v1/purchase-orders/template.csv');

    const input = document.querySelector('input[type=file][accept^=".csv"]') as HTMLInputElement;
    const file = new File(['number,vendor_id\n'], 'pos.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('Nothing was saved')).toBeTruthy();
    expect(screen.getByText(/Unknown vendor ID "V9"/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Save \d/ })).toBeNull();
    expect(calls).toEqual(['true']);
  });
});
