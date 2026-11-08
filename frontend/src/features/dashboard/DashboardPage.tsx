import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { CASE_STATUSES } from '@/api/types';
import { Alert, Card, ErrorMessage, Loading, PageHeader } from '@/components';
import { STATUS_META } from '@/lib/tones';
import { CaseTable, compactCaseColumns } from '@/features/cases/CaseTable';
import { useCases, useStats } from '@/features/cases/hooks';

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

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Invoice processing at a glance."
        actions={
          <>
            <button className="btn" disabled={reset.isPending}
              title="Clear processing data, vendors, purchase orders, FX rates and policy"
              onClick={() => reset.mutate()}>
              {reset.isPending ? 'Starting fresh…' : 'Refresh & start fresh'}
            </button>
            <Link className="btn" to="/inbox">Process from inbox</Link>
            <Link className="btn btn-primary" to="/upload">Upload invoice</Link>
          </>
        }
      />
      <p className="small muted">Refresh clears all processed cases, uploaded documents, audit history, PO reservations and reference data (vendors, purchase orders, FX rates and policy). Test inputs are kept.</p>
      {reset.error && <ErrorMessage error={reset.error} title="Could not start fresh" />}
      {fresh && <Alert tone="info" title="Fresh start complete">Processing and reference data have been cleared.</Alert>}
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
