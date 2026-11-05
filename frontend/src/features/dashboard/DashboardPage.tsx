import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { CASE_STATUSES } from '@/api/types';
import { Alert, Card, ErrorMessage, Loading, PageHeader } from '@/components';
import { STATUS_META } from '@/lib/tones';
import { CaseTable, compactCaseColumns } from '@/features/cases/CaseTable';
import { useCases, useStats } from '@/features/cases/hooks';

export default function DashboardPage() {
  const stats = useStats();
  const queue = useCases({ status: 'review', limit: 5, offset: 0 });
  const recent = useCases({ limit: 5, offset: 0 });
  const health = useQuery({ queryKey: qk.health, queryFn: systemApi.health });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Invoice processing at a glance."
        actions={
          <>
            <Link className="btn" to="/inbox">Process from inbox</Link>
            <Link className="btn btn-primary" to="/upload">Upload invoice</Link>
          </>
        }
      />
      {health.data && !health.data.extraction_configured && (
        <Alert tone="warn" title="Extraction is not configured">
          New cases go to review with <code>EXTRACTION_NOT_CONFIGURED</code>. Set <code>EXTRACTION_MODEL</code> and
          provider credentials on the backend, then retry the affected cases.
        </Alert>
      )}
      {health.data && health.data.worker_enabled && !health.data.worker_alive && (
        <Alert tone="danger" title="The processing worker is not running">Queued cases will not progress.</Alert>
      )}
      {stats.error && <ErrorMessage error={stats.error} title="Could not load statistics" />}
      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        {CASE_STATUSES.map((s) => (
          <Link key={s} to={`/cases?status=${s}`} className="tile">
            <div className="label">{STATUS_META[s].label}</div>
            <div className="value">{stats.data ? stats.data.counts[s] ?? 0 : '–'}</div>
            <div className="small muted">{STATUS_META[s].description}</div>
          </Link>
        ))}
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
