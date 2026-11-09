import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { Money, ProblemStats, Statistics, VendorStats } from '@/api/types';
import { Alert, Badge, Card, DataTable, Empty, ErrorMessage, Loading, PageHeader } from '@/components';
import { explain } from '@/features/cases/overview/insights';
import { formatAmount, formatDateTime } from '@/lib/format';
import { SegmentedBar } from './charts';

/** Plain-language name of a problem code, shared with the case Summary tab. */
function problem(code: string) {
  return explain({ code, field: null, message: code, stage: 'statistics' });
}

const pct = (rate: number | null | undefined) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function MoneyList({ items }: { items: Money[] }) {
  if (!items.length) return <span className="muted">—</span>;
  return (
    <div className="stack" style={{ gap: 2 }}>
      {items.map((m) => <span key={m.currency}>{formatAmount(m.amount, m.currency)}</span>)}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="small muted">{note}</div>}
    </div>
  );
}

function ProblemName({ code }: { code: string }) {
  const p = problem(code);
  return (
    <span title={`${p.why} ${p.action}`}>
      {p.title} <span className="small muted mono">{code}</span>
    </span>
  );
}

function Overview({ s }: { s: Statistics }) {
  const t = s.totals;
  const inFlight = (t.by_status.queued ?? 0) + (t.by_status.processing ?? 0);
  return (
    <>
      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        <Tile label="Total cases" value={t.cases} note={plural(t.vendors, 'vendor')} />
        <Tile label="Invoices with problems" value={t.cases_with_invoice_problems} note={`${pct(t.finished ? t.cases_with_invoice_problems / t.finished : null)} of finished cases`} />
        <Tile label="Approved value" value={<MoneyList items={t.approved_value} />} />
        <Tile label="Value held for review" value={<MoneyList items={t.held_value} />} />
      </div>
      <Card title="Outcomes">
        <SegmentedBar
          label="Case outcomes"
          segments={[
            { key: 'auto', label: 'Approved automatically', value: t.approved_automatic, color: 'var(--ok)' },
            { key: 'manual', label: 'Approved manually', value: t.approved_manual, color: 'var(--info)' },
            { key: 'review', label: 'Needs review', value: t.by_status.review ?? 0, color: 'var(--warn)' },
            { key: 'duplicate', label: 'Duplicate', value: t.by_status.duplicate ?? 0, color: 'var(--neutral)' },
            ...(inFlight > 0 ? [{ key: 'flight', label: 'Still processing', value: inFlight, color: 'var(--border)' }] : []),
          ]}
        />
      </Card>
    </>
  );
}

function Highlights({ s }: { s: Statistics }) {
  const vendors = s.highlights.most_problematic_vendors.map((k) => s.vendors.find((v) => v.key === k)!).filter(Boolean);
  const problems = s.highlights.most_common_problems.map((c) => s.problems.find((p) => p.code === c)!).filter(Boolean);
  return (
    <div className="grid grid-2">
      <Card title={vendors.length > 1 ? 'Most problematic vendors (tied)' : 'Most problematic vendor'}>
        {vendors.length === 0 ? <Empty>No vendor has had an invoice problem.</Empty> : vendors.map((v) => (
          <div key={v.key} className="stack" style={{ gap: 4, marginBottom: 8 }}>
            <div className="stat-value" style={{ marginTop: 0 }}>{v.name}</div>
            <div><strong>{v.problem_cases} of {v.approved + v.review + v.duplicate}</strong> invoices had problems ({pct(v.problem_rate)})</div>
            <div className="small muted">Mostly: {v.top_problems.map((c) => problem(c).title).join(' / ')}</div>
          </div>
        ))}
      </Card>
      <Card title={problems.length > 1 ? 'Most common problems (tied)' : 'Most common problem'}>
        {problems.length === 0 ? <Empty>No invoice problems found.</Empty> : problems.map((p) => {
          const e = problem(p.code);
          return (
            <div key={p.code} className="stack" style={{ gap: 4, marginBottom: 8 }}>
              <div className="row">
                <div className="stat-value" style={{ marginTop: 0 }}>{e.title}</div>
                {e.severity === 'high' && <Badge tone="danger">high risk</Badge>}
              </div>
              <div><strong>{plural(p.cases, 'case')}</strong> from {plural(p.vendors.length, 'vendor')}</div>
              <div className="small muted">{e.why}</div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Vendors({ s }: { s: Statistics }) {
  return (
    <Card title="Vendors">
      <DataTable<VendorStats>
        rows={s.vendors}
        rowKey={(v) => v.key}
        empty="No cases yet."
        columns={[
          {
            key: 'name',
            header: 'Vendor',
            render: (v) => (
              <span className="stack" style={{ gap: 2 }}>
                <span>{v.name}</span>
                {!v.in_master && <span className="small muted">{v.key === 'unidentified' ? 'could not be read' : 'not in vendor master'}</span>}
              </span>
            ),
          },
          { key: 'cases', header: 'Invoices', numeric: true, render: (v) => v.cases },
          { key: 'approved', header: 'Approved', numeric: true, render: (v) => (v.approved_manual ? `${v.approved} (${v.approved_manual} manual)` : v.approved) },
          { key: 'review', header: 'Needs review', numeric: true, render: (v) => v.review },
          { key: 'duplicate', header: 'Duplicate', numeric: true, render: (v) => v.duplicate },
          {
            key: 'problems',
            header: 'Problems (invoices affected)',
            render: (v) => (v.problems.length ? (
              <div className="chips">
                {v.problems.map((p) => (
                  <span key={p.code} className={`chip${v.top_problems.includes(p.code) ? ' top' : ''}`} title={problem(p.code).why}>
                    {problem(p.code).title} <strong>{p.cases}</strong>
                  </span>
                ))}
              </div>
            ) : <span className="muted">None</span>),
          },
        ]}
      />
      <p className="small muted" style={{ marginBottom: 0 }}>Highlighted: each vendor's most common problem.</p>
    </Card>
  );
}

function Problems({ s }: { s: Statistics }) {
  const invoice = s.problems.filter((p) => p.category === 'invoice');
  const processing = s.problems.filter((p) => p.category === 'processing');
  return (
    <>
      <Card title="Problems">
        <DataTable<ProblemStats>
          rows={invoice}
          rowKey={(p) => p.code}
          empty="No invoice problems found."
          columns={[
            {
              key: 'name',
              header: 'Problem',
              render: (p) => (
                <span className="row" style={{ gap: 6 }}>
                  <ProblemName code={p.code} />
                  {problem(p.code).severity === 'high' && <Badge tone="danger">high risk</Badge>}
                </span>
              ),
            },
            { key: 'cases', header: 'Cases', numeric: true, render: (p) => `${p.cases} (${pct(p.share_of_cases)})` },
            { key: 'vendors', header: 'Vendors', render: (p) => p.vendors.map((v) => `${v.name} (${v.cases})`).join(', ') },
          ]}
        />
      </Card>
      {processing.length > 0 && (
        <Alert tone="warn">
          {plural(s.totals.cases_with_processing_problems, 'case')} could not be read automatically
          ({processing.map((p) => `${p.code} ${p.cases}`).join(', ')}). This is a setup issue, not the vendor's, so it isn't counted above.
          Fix it, then use <strong style={{ display: 'inline' }}>Retry processing</strong>. <Link to="/cases?status=review">Open cases in review</Link>
        </Alert>
      )}
    </>
  );
}

export default function StatisticsPage() {
  const { data, error, isLoading } = useQuery({ queryKey: qk.statistics, queryFn: systemApi.statistics, refetchInterval: 10_000 });
  return (
    <>
      <PageHeader
        title="Statistics"
        subtitle={data ? `${plural(data.totals.cases, 'case')} currently in the system (cleared on reset) · updated ${formatDateTime(data.generated_at)}` : 'Totals, vendors and problems across every case.'}
      />
      {error && <ErrorMessage error={error} title="Could not load statistics" />}
      {isLoading && <Loading />}
      {data && data.totals.cases === 0 && (
        <Empty>
          No cases yet. Send invoices from the <Link to="/inbox">Inbox</Link> or <Link to="/upload">Upload</Link> them, and statistics appear here.
        </Empty>
      )}
      {data && data.totals.cases > 0 && (
        <>
          <h2 className="eyebrow" style={{ marginTop: 8 }}>Overall</h2>
          <Overview s={data} />
          <h2 className="eyebrow" style={{ marginTop: 24 }}>Highlights</h2>
          <Highlights s={data} />
          <h2 className="eyebrow" style={{ marginTop: 24 }}>Details</h2>
          <Vendors s={data} />
          <Problems s={data} />
        </>
      )}
    </>
  );
}
