import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import type { Tone } from '@/lib/tones';

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`alert tone-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

const HINTS: Record<number, string> = {
  401: 'The backend requires X-API-Key. Set BACKEND_API_KEY for the frontend proxy (see frontend/README.md).',
  403: 'The reviewer key was rejected. Update it in Settings.',
  409: 'The case changed since you loaded it. Reload and try again.',
  503: 'The server is missing configuration (for review actions: REVIEWER_API_KEY).',
};

export function ErrorMessage({ error, title = 'Something went wrong' }: { error: unknown; title?: string }) {
  if (!error) return null;
  const apiErr = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : String(error);
  const hint = apiErr ? HINTS[apiErr.status] : undefined;
  return (
    <Alert tone="danger" title={title}>
      <div className="wrap">{message}</div>
      {apiErr && apiErr.code && <div className="small mono">{apiErr.code}{apiErr.status ? ` · HTTP ${apiErr.status}` : ''}</div>}
      {hint && <div className="small">{hint}</div>}
    </Alert>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty" role="status">{label}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
