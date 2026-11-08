
/** Base URL for API calls. Empty means same origin (dev proxy or reverse proxy). */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

/** Normalises both backend error formats: {error:{code,message}} and FastAPI {detail}. */
export async function toApiError(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  const body = data as { error?: { code?: string; message?: string }; detail?: unknown } | null;
  if (body?.error) {
    return new ApiError(res.status, body.error.code ?? 'ERROR', body.error.message ?? res.statusText, data);
  }
  if (body?.detail !== undefined) {
    const detail = body.detail;
    const message = Array.isArray(detail)
      ? detail
          .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.') || 'request'}: ${d.msg}`)
          .join('; ')
      : String(detail);
    return new ApiError(res.status, `HTTP_${res.status}`, message, data);
  }
  return new ApiError(res.status, `HTTP_${res.status}`, res.statusText || 'Request failed', data);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the backend. Is it running?');
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
