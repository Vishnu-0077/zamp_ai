import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { API_BASE } from '@/api/client';
import { Badge, Card, ErrorMessage, KeyValue, PageHeader } from '@/components';
import { ReviewerNameField } from '@/features/cases/components/ReviewerNameField';
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';

export default function SettingsPage() {
  const [theme, setTheme] = useState(currentTheme);
  const health = useQuery({ queryKey: qk.health, queryFn: systemApi.health });
  const yes = (b?: boolean) => <Badge tone={b ? 'ok' : 'danger'}>{b ? 'yes' : 'no'}</Badge>;

  return (
    <>
      <PageHeader title="Settings" />
      <Card title="You">
        <p className="muted" style={{ marginTop: 0 }}>
          Anyone using this dashboard can correct, approve and retry cases. Your name is recorded with each action in the
          audit trail and the approved-invoices Excel, and is remembered in this browser.
        </p>
        <ReviewerNameField />
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
