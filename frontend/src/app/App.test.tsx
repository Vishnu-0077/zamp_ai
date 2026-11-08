import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { setReviewerName } from '@/lib/reviewerName';
import { caseDetail } from '@/test/fixtures';

function mockBackend() {
  const c = caseDetail();
  const routes: Record<string, unknown> = {
    '/health': { status: 'ok', worker_enabled: true, worker_alive: true, extraction_configured: false },
    '/api/v1/stats': { counts: { review: 1 } },
    '/api/v1/cases': { items: [c], total: 1, limit: 25, offset: 0 },
    [`/api/v1/cases/${c.id}`]: c,
    [`/api/v1/cases/${c.id}/audit`]: { items: [] },
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const body = routes[path];
    return new Response(JSON.stringify(body ?? { detail: 'Not Found' }), { status: body ? 200 : 404 });
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setReviewerName('');
});

describe('App', () => {
  it('starts fresh from the home page and reloads the case list', async () => {
    let cleared = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/reset') {
        expect(options?.method).toBe('POST');
        cleared = true;
        return Response.json({ status: 'reset' });
      }
      if (path === '/health') return Response.json({ status: 'ok', worker_enabled: true, worker_alive: true, extraction_configured: true });
      if (path === '/api/v1/stats') return Response.json({ counts: cleared ? {} : { review: 1 } });
      return Response.json({ items: cleared ? [] : [caseDetail()], total: cleared ? 0 : 1, limit: 5, offset: 0 });
    });
    window.history.pushState({}, '', '/');
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Refresh & start fresh' });
    fireEvent.click(button);
    expect(await screen.findByText('Fresh start complete')).toBeTruthy();
    expect(await screen.findByText('Nothing waiting for review.')).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/api/v1/reset'))).toBe(true);
  });

  it('renders the dashboard with navigation built from the feature registry', async () => {
    mockBackend();
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    const download = screen.getByRole('link', { name: /Approved invoices \(Excel\)/ });
    expect(download.getAttribute('href')).toBe('/api/v1/exports/approved-invoices.xlsx');
    expect(download.hasAttribute('download')).toBe(true);
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    for (const label of ['Dashboard', 'Cases', 'Inbox', 'Upload', 'Reference data', 'Settings']) {
      expect(nav.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(await screen.findByText('Extraction is not configured')).toBeTruthy();
  });

  it('opens a review case on a plain-language summary, then the PDF and correction view', async () => {
    mockBackend();
    window.history.pushState({}, '', `/cases/${caseDetail().id}`);
    render(<App />);
    expect(await screen.findByText('Why this needs your review')).toBeTruthy();
    expect(screen.getByText('LOW_CONFIDENCE')).toBeTruthy();
    expect(screen.getByText('Invoice vs purchase order')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Compare with PDF & resolve/ }));
    expect(await screen.findByText('Purchase order not found')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save corrections & re-check/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Approve manually/ })).toBeTruthy();
  });
});
