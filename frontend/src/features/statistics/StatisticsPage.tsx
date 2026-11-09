import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { Money, ProblemStats, Statistics, VendorStats } from '@/api/types';
import { Alert, Badge, Card, DataTable, Empty, ErrorMessage, Loading, PageHeader } from '@/components';
import { explain, fieldLabel } from '@/features/cases/overview/insights';
import { formatAmount, formatDateTime } from '@/lib/format';
import { HBars, SegmentedBar } from './charts';

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
  return (
    <>
      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        <Tile label="Total cases" value={t.cases} note={`${t.finished} finished · ${t.vendors} vendors`} />
        <Tile label="Approved" value={t.by_status.approved ?? 0} note={`${t.approved_automatic} automatically · ${t.approved_manual} manually`} />
        <Tile label="Needs review" value={t.by_status.review ?? 0} note="Held for a person" />
        <Tile label="Duplicates" value={t.by_status.duplicate ?? 0} note="Already processed before" />
        <Tile label="Approval rate" value={pct(t.approval_rate)} note="Approved ÷ finished cases" />
        <Tile label="Straight-through" value={pct(t.straight_through_rate)} note="Approved with no person involved" />
        <Tile label="Invoices with problems" value={t.cases_with_invoice_problems} note={`${pct(t.finished ? t.cases_with_invoice_problems / t.finished : null)} of finished cases`} />
        <Tile label="Approved value" value={<MoneyList items={t.approved_value} />} />
        <Tile label="Value held for review" value={<MoneyList items={t.held_value} />} />
      </div>
      <Card title="Outcome of every case">
        <SegmentedBar
          label="Case outcomes"
          segments={[
            { key: 'auto', label: 'Approved automatically', value: t.approved_automatic, color: 'var(--ok)' },
            { key: 'manual', label: 'Approved manually', value: t.approved_manual, color: 'var(--info)' },
            { key: 'review', label: 'Needs review', value: t.by_status.review ?? 0, color: 'var(--warn)' },
            { key: 'duplicate', label: 'Duplicate', value: t.by_status.duplicate ?? 0, color: 'var(--neutral)' },
            ...((t.by_status.queued ?? 0) + (t.by_status.processing ?? 0) > 0
              ? [{ key: 'flight', label: 'Still processing', value: (t.by_status.queued ?? 0) + (t.by_status.processing ?? 0), color: 'var(--border)' }]
              : []),
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
        {vendors.length === 0 ? (
          <Empty>No vendor has had an invoice problem.</Empty>
        ) : (
          vendors.map((v) => (
            <div key={v.key} className="stack" style={{ gap: 6, marginBottom: 12 }}>
              <div className="stat-value" style={{ marginTop: 0 }}>{v.name}</div>
              <div>
                <strong>{v.problem_cases} of {v.approved + v.review + v.duplicate}</strong> finished invoices had problems ({pct(v.problem_rate)}).
              </div>
              <div className="small muted">
                Most common: {v.top_problems.map((c) => problem(c).title).join(' / ')} ({plural(v.top_problem_cases, 'invoice')})
              </div>
            </div>
          ))
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Ranked by the number of invoices with problems, then by the share of the vendor's invoices. Processing failures
          (OCR or model errors) never count against a vendor.
        </p>
      </Card>
      <Card title={problems.length > 1 ? 'Most common problems (tied)' : 'Most common problem'}>
        {problems.length === 0 ? (
          <Empty>No invoice problems found.</Empty>
        ) : (
          problems.map((p) => {
            const e = problem(p.code);
            return (
              <div key={p.code} className="stack" style={{ gap: 6, marginBottom: 12 }}>
                <div className="row">
                  <div className="stat-value" style={{ marginTop: 0 }}>{e.title}</div>
                  {e.severity === 'high' && <Badge tone="danger">high risk</Badge>}
                </div>
                <div><strong>{plural(p.cases, 'case')}</strong> ({pct(p.share_of_cases)} of all cases), from {plural(p.vendors.length, 'vendor')}: {p.vendors.map((v) => `${v.name} (${v.cases})`).join(', ')}.</div>
                <div className="small muted">{e.why}</div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

function Vendors({ s }: { s: Statistics }) {
  const withProblems = s.vendors.filter((v) => v.problem_cases > 0);
  return (
    <>
      <Card title="Invoices with problems, by vendor">
        {withProblems.length === 0 ? <Empty>No vendor has had an invoice problem.</Empty> : (
          <HBars
            label="Invoices with problems by vendor"
            data={withProblems.map((v) => ({
              key: v.key,
              label: v.name,
              value: v.problem_cases,
              display: `${v.problem_cases} of ${v.approved + v.review + v.duplicate} (${pct(v.problem_rate)})`,
              title: `${v.name}: ${v.problem_cases} invoices with problems, ${v.problem_occurrences} problems in total`,
            }))}
          />
        )}
      </Card>
      <Card title="Vendor statistics">
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
                  <span className="small muted">{v.vendor_id ?? (v.key === 'unidentified' ? 'could not be read' : 'not in vendor master')}</span>
                </span>
              ),
            },
            { key: 'cases', header: 'Invoices', numeric: true, render: (v) => v.cases },
            { key: 'approved', header: 'Approved', numeric: true, render: (v) => (v.approved_manual ? `${v.approved} (${v.approved_manual} manual)` : v.approved) },
            { key: 'review', header: 'Needs review', numeric: true, render: (v) => v.review },
            { key: 'duplicate', header: 'Duplicate', numeric: true, render: (v) => v.duplicate },
            { key: 'problems', header: 'With problems', numeric: true, render: (v) => (v.problem_cases ? `${v.problem_cases} (${pct(v.problem_rate)})` : '0') },
            {
              key: 'top',
              header: 'Most common problem',
              render: (v) => (v.top_problems.length ? `${v.top_problems.map((c) => problem(c).title).join(' / ')} (${v.top_problem_cases})` : <span className="muted">None</span>),
            },
            { key: 'value', header: 'Approved value', numeric: true, render: (v) => <MoneyList items={v.approved_value} /> },
          ]}
        />
      </Card>
      <Card title="Problems by vendor">
        {withProblems.length === 0 ? <Empty>No vendor has had an invoice problem.</Empty> : (
          <div className="stack">
            {withProblems.map((v) => (
              <div key={v.key}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {v.name} <span className="small muted">· {plural(v.problem_cases, 'invoice')} with problems</span>
                </div>
                <div className="chips">
                  {v.problems.map((p) => (
                    <span key={p.code} className={`chip${v.top_problems.includes(p.code) ? ' top' : ''}`} title={problem(p.code).why}>
                      {problem(p.code).title} <strong>{p.cases}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <p className="small muted" style={{ margin: 0 }}>Highlighted: the vendor's most common problem. Numbers are invoices affected.</p>
          </div>
        )}
      </Card>
    </>
  );
}

function Problems({ s }: { s: Statistics }) {
  const invoice = s.problems.filter((p) => p.category === 'invoice');
  const processing = s.problems.filter((p) => p.category === 'processing');
  const columns = [
    { key: 'name', header: 'Problem', render: (p: ProblemStats) => <ProblemName code={p.code} /> },
    { key: 'risk', header: 'Risk', render: (p: ProblemStats) => (problem(p.code).severity === 'high' ? <Badge tone="danger">high</Badge> : <Badge tone="neutral">medium</Badge>) },
    { key: 'cases', header: 'Cases', numeric: true, render: (p: ProblemStats) => p.cases },
    { key: 'share', header: '% of cases', numeric: true, render: (p: ProblemStats) => pct(p.share_of_cases) },
    { key: 'vendors', header: 'Vendors affected', render: (p: ProblemStats) => p.vendors.map((v) => `${v.name} (${v.cases})`).join(', ') },
    {
      key: 'fields',
      header: 'Fields',
      render: (p: ProblemStats) => (p.fields.length ? p.fields.map((f) => `${fieldLabel(f.field)} (${f.cases})`).join(', ') : <span className="muted">—</span>),
    },
  ];
  return (
    <>
      <Card title="Cases affected, by problem">
        {invoice.length === 0 ? <Empty>No invoice problems found.</Empty> : (
          <HBars
            label="Cases affected by problem"
            data={invoice.map((p) => ({
              key: p.code,
              label: problem(p.code).title,
              value: p.cases,
              display: `${p.cases} (${pct(p.share_of_cases)})`,
              title: `${p.code}: ${problem(p.code).why}`,
            }))}
          />
        )}
      </Card>
      <Card title="Problem statistics">
        <DataTable<ProblemStats> rows={invoice} rowKey={(p) => p.code} empty="No invoice problems found." columns={columns} />
        <p className="small muted" style={{ marginBottom: 0 }}>Each problem is counted once per case, however many times it was raised.</p>
      </Card>
      {processing.length > 0 && (
        <Card title="Processing problems (system, not vendor)">
          <Alert tone="warn">
            {plural(s.totals.cases_with_processing_problems, 'case')} could not be read automatically. This is caused by the setup
            (OCR or the AI model), not by the vendor. Fix the cause, then use <strong style={{ display: 'inline' }}>Retry processing</strong> on
            each case. <Link to="/cases?status=review">Open cases in review</Link>
          </Alert>
          <DataTable<ProblemStats> rows={processing} rowKey={(p) => p.code} columns={columns.filter((c) => c.key !== 'risk' && c.key !== 'fields')} />
        </Card>
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
        subtitle={data ? `Across all ${plural(data.totals.cases, 'case')} currently in the system · updated ${formatDateTime(data.generated_at)}` : 'Totals, vendors and problems across every case.'}
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
          <h2 className="eyebrow" style={{ marginTop: 24 }}>By vendor</h2>
          <Vendors s={data} />
          <h2 className="eyebrow" style={{ marginTop: 24 }}>By problem</h2>
          <Problems s={data} />
          <p className="small muted">Statistics cover the cases currently in the system, so <strong style={{ display: 'inline' }}>Refresh &amp; start fresh</strong> and backend restarts reset them.</p>
        </>
      )}
    </>
  );
}
