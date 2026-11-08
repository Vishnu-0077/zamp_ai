import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildUrl, request, toApiError } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toApiError', () => {
  it('reads service error envelopes', async () => {
    const e = await toApiError(json(409, { error: { code: 'CONFLICT', message: 'Case changed' } }));
    expect(e).toMatchObject({ status: 409, code: 'CONFLICT', message: 'Case changed' });
  });
  it('reads FastAPI validation details', async () => {
    const e = await toApiError(json(422, { detail: [{ loc: ['body', 'note'], msg: 'too short' }] }));
    expect(e.message).toBe('note: too short');
  });
  it('reads string details', async () => {
    const e = await toApiError(json(404, { detail: 'Not Found' }));
    expect(e).toMatchObject({ status: 404, message: 'Not Found' });
  });
});

describe('request', () => {
  it('builds query strings, skipping empty values', () => {
    expect(buildUrl('/api/v1/cases', { status: undefined, limit: 25, offset: 0 })).toBe('/api/v1/cases?limit=25&offset=0');
  });
  it('sends JSON bodies and never a reviewer key header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    await request('/x', { method: 'POST', json: { a: 1 } });
    const init = spy.mock.calls[0][1]!;
    expect(init.body).toBe('{"a":1}');
    expect(init.headers as Record<string, string>).not.toHaveProperty('X-Reviewer-Key');
  });
  it('maps network failures to ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await request('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
