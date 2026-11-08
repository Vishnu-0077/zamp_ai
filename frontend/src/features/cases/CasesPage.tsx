import { useSearchParams } from 'react-router-dom';
import { CASE_STATUSES, type CaseStatus } from '@/api/types';
import { Card, ErrorMessage, Loading, PageHeader, Pagination } from '@/components';
import { STATUS_META } from '@/lib/tones';
import { CaseTable } from './CaseTable';
import { useCases, useStats } from './hooks';
import { DownloadApprovedButton } from './DownloadApprovedButton';

const LIMIT = 25;

export default function CasesPage() {
  const [params, setParams] = useSearchParams();
  const status = (CASE_STATUSES.includes(params.get('status') as CaseStatus) ? params.get('status') : undefined) as CaseStatus | undefined;
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const { data, error, isLoading, isFetching } = useCases({ status, limit: LIMIT, offset });
  const { data: stats } = useStats();

  const update = (next: { status?: string; offset?: number }) => {
    const p = new URLSearchParams(params);
    if ('status' in next) next.status ? p.set('status', next.status) : p.delete('status');
    next.offset ? p.set('offset', String(next.offset)) : p.delete('offset');
    setParams(p);
  };

  const total = Object.values(stats?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader title="Cases" subtitle="Every processed invoice, newest first." actions={<DownloadApprovedButton primary={status === 'approved'} />} />
      <div className="tabs" role="tablist" aria-label="Filter by status">
        <button role="tab" aria-selected={!status} onClick={() => update({ status: undefined })}>
          All {stats && <span className="muted">({total})</span>}
        </button>
        {CASE_STATUSES.map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => update({ status: s })}>
            {STATUS_META[s].label} {stats && <span className="muted">({stats.counts[s] ?? 0})</span>}
          </button>
        ))}
      </div>
      <Card actions={isFetching && !isLoading ? <span className="muted small">Refreshing…</span> : undefined}>
        {error && <ErrorMessage error={error} title="Could not load cases" />}
        {isLoading ? <Loading /> : data && (
          <>
            <CaseTable rows={data.items} empty={status ? `No ${STATUS_META[status].label.toLowerCase()} cases.` : undefined} />
            <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={(o) => update({ offset: o })} />
          </>
        )}
      </Card>
    </>
  );
}
