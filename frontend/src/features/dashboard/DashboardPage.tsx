import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { CASE_STATUSES } from '@/api/types';
import { Alert, Card, ErrorMessage, Loading, PageHeader } from '@/components';
import { STATUS_META, type Tone } from '@/lib/tones';
import type { CaseStatus } from '@/api/types';
import type { CSSProperties, ReactNode } from 'react';
import { CaseTable, compactCaseColumns } from '@/features/cases/CaseTable';
import { useCases, useStats } from '@/features/cases/hooks';
import { DownloadApprovedButton } from '@/features/cases/DownloadApprovedButton';

export default function DashboardPage() {
  const client = useQueryClient();
  const [fresh, setFresh] = useState(false);
  const reset = useMutation({
    mutationFn: async () => {
      setFresh(false);
      await systemApi.reset();
      await client.cancelQueries();
      client.removeQueries({ predicate: (query) => query.getObserversCount() === 0 });
      await client.resetQueries();
    },
    onSuccess: () => setFresh(true),
  });
  const stats = useStats();
  const queue = useCases({ status: 'review', limit: 5, offset: 0 });
  const recent = useCases({ limit: 5, offset: 0 });
  const health = useQuery({ queryKey: qk.health, queryFn: systemApi.health });
  const totalCases = Object.values(stats.data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Invoice processing at a glance."
        actions={
          <>
            <button className="btn" disabled={reset.isPending}
              title="Clear processed cases and reload trusted reference data"
              onClick={() => reset.mutate()}>
              {reset.isPending ? 'Starting fresh…' : 'Refresh & start fresh'}
            </button>
            <DownloadApprovedButton />
            <Link className="btn" to="/statistics">Statistics</Link>
            <Link className="btn" to="/inbox">Process from inbox</Link>
            <Link className="btn btn-primary" to="/upload">Upload invoice</Link>
          </>
        }
      />
      <p className="small muted">Refresh clears processed cases, uploaded documents, audit history, PO reservations and purchase orders added under Upload → Upload PO. The built-in vendor, PO and FX configuration is retained to validate new invoices.</p>
      {reset.error && <ErrorMessage error={reset.error} title="Could not start fresh" />}
      {fresh && <Alert tone="info" title="Fresh start complete">Processing results have been cleared; trusted reference data is ready for new invoices.</Alert>}
      {health.data && !health.data.extraction_configured && (
        <Alert tone="warn" title="Extraction is not configured">
          New cases go to review with <code>EXTRACTION_NOT_CONFIGURED</code>. Set <code>EXTRACTION_MODEL</code> and
          provider credentials on the backend, then retry the affected cases.
        </Alert>
      )}
      {health.data && health.data.worker_enabled && !health.data.worker_alive && (
        <Alert tone="danger" title="The processing worker is not running">Queued cases will not progress.</Alert>
      )}
      {health.data?.references_configured === false && <Alert tone="warn" title="Reference data is missing">Load trusted vendors and purchase orders before processing. Without them, invoices must go to review.</Alert>}
      {stats.data?.inbox_counts && (
        <div className="outcome-strip" aria-label="Inbox email outcomes">
          <span className="outcome-strip-title">Inbox emails</span>
          {CASE_STATUSES.map((s) => (
            <span key={s} className="outcome-chip" style={toneVars(STATUS_META[s].tone)}>
              <span className="outcome-dot" aria-hidden="true" />
              {STATUS_META[s].label}
              <strong>{stats.data?.inbox_counts?.[s] ?? 0}</strong>
            </span>
          ))}
          <span className="small muted">Identical attachments share one case; a PDF with several invoices becomes one case per invoice.</span>
        </div>
      )}
      {stats.error && <ErrorMessage error={stats.error} title="Could not load statistics" />}
      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        {CASE_STATUSES.map((s) => {
          const count = stats.data ? stats.data.counts[s] ?? 0 : null;
          const share = count && totalCases ? Math.round((count / totalCases) * 100) : 0;
          return (
            <Link key={s} to={`/cases?status=${s}`} className="tile status-tile" style={toneVars(STATUS_META[s].tone)}>
              <div className="status-tile-head">
                <span className="status-icon" aria-hidden="true">{STATUS_ICONS[s]}</span>
                <span className="label">{STATUS_META[s].label}</span>
              </div>
              <div className="value">{count ?? '–'}</div>
              <div className="small muted">{STATUS_META[s].description}</div>
              <div className="status-share" title={`${share}% of all cases`}>
                <div className="status-share-track"><span style={{ width: `${share}%` }} /></div>
                <span>{share}%</span>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="grid grid-2">
        <Card title="Review queue" actions={<Link to="/cases?status=review">View all</Link>}>
          {queue.isLoading ? <Loading /> : <CaseTable rows={queue.data?.items ?? []} columns={compactCaseColumns} empty="Nothing waiting for review." />}
        </Card>
        <Card title="Recent activity" actions={<Link to="/cases">All cases</Link>}>
          {recent.isLoading ? <Loading /> : <CaseTable rows={recent.data?.items ?? []} columns={compactCaseColumns} />}
        </Card>
      </div>
    </>
  );
}

/** Per-tile accent colours, taken from the status tone tokens. */
function toneVars(tone: Tone): CSSProperties {
  return { '--tone': `var(--${tone})`, '--tone-soft': `var(--${tone}-soft)` } as CSSProperties;
}

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const STATUS_ICONS: Record<CaseStatus, ReactNode> = {
  queued: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  processing: svg(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>),
  review: svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  approved: svg(<><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>),
  duplicate: svg(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
};
