import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { API_BASE } from '@/api/client';
import { Alert, Badge, Card, ErrorMessage, KeyValue, PageHeader } from '@/components';
import { setReviewerKey, useReviewerKey } from '@/lib/reviewerKey';
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';

export default function SettingsPage() {
  const current = useReviewerKey();
  const [draft, setDraft] = useState('');
  const [theme, setTheme] = useState(currentTheme);
  const health = useQuery({ queryKey: qk.health, queryFn: systemApi.health });
  const yes = (b?: boolean) => <Badge tone={b ? 'ok' : 'danger'}>{b ? 'yes' : 'no'}</Badge>;

  return (
    <>
      <PageHeader title="Settings" />
      <Card title="Reviewer credential">
        <p className="muted" style={{ marginTop: 0 }}>
          Corrections and retries need the reviewer key (<code>X-Reviewer-Key</code>). It is kept in this browser tab's session storage only
          and is cleared when the tab closes.
        </p>
        {current ? <Alert tone="ok">A reviewer key is set for this session.</Alert> : <Alert tone="warn">No reviewer key set. Review actions are disabled.</Alert>}
        <form className="row" style={{ flexWrap: 'nowrap', maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); setReviewerKey(draft.trim()); setDraft(''); }}>
          <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reviewer key" aria-label="Reviewer key" />
          <button className="btn btn-primary" disabled={!draft.trim()}>Save</button>
          {current && <button type="button" className="btn btn-danger" onClick={() => setReviewerKey('')}>Clear</button>}
        </form>
      </Card>
      <Card title="Appearance">
        <label className="field" style={{ maxWidth: 240 }}>
          Theme
          <select value={theme} onChange={(e) => { setTheme(e.target.value as Theme); applyTheme(e.target.value); }}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </Card>
      <Card title="Backend">
        {health.error && <ErrorMessage error={health.error} title="Backend unreachable" />}
        <KeyValue
          items={[
            ['API base', <code key="b">{API_BASE || '(same origin, via proxy)'}</code>],
            ['Status', health.data?.status ?? '—'],
            ['Worker enabled', yes(health.data?.worker_enabled)],
            ['Worker alive', yes(health.data?.worker_alive)],
            ['Extraction configured', yes(health.data?.extraction_configured)],
          ]}
        />
        <p className="small muted">
          The application key (<code>X-API-Key</code>) is injected by the frontend proxy from <code>BACKEND_API_KEY</code> and never reaches the browser.
          API docs: <a href="/docs" target="_blank" rel="noreferrer">/docs</a> on the backend.
        </p>
      </Card>
    </>
  );
}
