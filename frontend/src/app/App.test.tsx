import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { setReviewerKey } from '@/lib/reviewerKey';
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
  setReviewerKey('');
});

describe('App', () => {
  it('starts fresh from the home page and reloads the case list', async () => {
    setReviewerKey('review-secret');
    let cleared = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/reset') {
        expect(options?.method).toBe('POST');
        expect(new Headers(options?.headers).get('X-Reviewer-Key')).toBe('review-secret');
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
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    for (const label of ['Dashboard', 'Cases', 'Inbox', 'Upload', 'Reference data', 'Settings']) {
      expect(nav.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(await screen.findByText('Extraction is not configured')).toBeTruthy();
  });

  it('renders a case detail with findings and decision', async () => {
    mockBackend();
    window.history.pushState({}, '', `/cases/${caseDetail().id}`);
    render(<App />);
    expect(await screen.findByText('Decision: review')).toBeTruthy();
    expect(screen.getByText('LOW_CONFIDENCE')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Correct & revalidate/ })).toBeTruthy();
  });
});
