import { Link, useParams, useSearchParams } from 'react-router-dom';
import { IN_FLIGHT, type CaseDetail, type PageText } from '@/api/types';
import {
  Alert, Card, ErrorMessage, JsonView, Loading, PageHeader, StatusBadge, Tabs, type TabDef,
} from '@/components';
import { formatDateTime, shortId } from '@/lib/format';
import { STATUS_META } from '@/lib/tones';
import { AuditTimeline } from './components/AuditTimeline';
import { ChecksView } from './components/ChecksView';
import { PagesView } from './components/PagesView';
import { CaseOverview } from './overview/CaseOverview';
import { ComparePanel } from './compare/ComparePanel';
import { referencesFor } from './overview/insights';
import { useCase } from './hooks';

function ProcessingBanner({ detail }: { detail: CaseDetail }) {
  if (!IN_FLIGHT.includes(detail.status)) return null;
  return <Alert tone="info" title={STATUS_META[detail.status].label}>This page refreshes automatically when processing finishes.</Alert>;
}

/**
 * Tabs on the case page. To add a view (e.g. "Payments", "Comments"), append a
 * TabDef here; it receives the full CaseDetail.
 */
function buildTabs(detail: CaseDetail, openReview: () => void): TabDef[] {
  return [
    { id: 'overview', label: 'Summary', render: () => <CaseOverview detail={detail} onReview={detail.status === 'review' ? openReview : undefined} /> },
    { id: 'review', label: detail.status === 'review' ? 'Compare & resolve' : 'Invoice vs PO', render: () => <ComparePanel detail={detail} /> },
    { id: 'checks', label: 'Checks', render: () => <Card><ChecksView checks={detail.checks as Record<string, unknown>} /></Card> },
    { id: 'pages', label: `Source text${detail.pages ? ` (${detail.pages.length})` : ''}`, render: () => <PagesView pages={detail.pages as PageText[] | null} /> },
    { id: 'audit', label: 'Audit trail', render: () => <Card><AuditTimeline caseId={detail.id} status={detail.status} /></Card> },
    {
      id: 'policy',
      label: 'Policy snapshot',
      hidden: !detail.policy_snapshot,
      render: () => <Card><p className="small muted">Procurement and policy data in force when this decision was made.</p><JsonView value={detail.policy_snapshot} /></Card>,
    },
  ];
}

export default function CaseDetailPage() {
  const { id = '' } = useParams();
  const { data: detail, error, isLoading, refetch, isFetching } = useCase(id);
  // The open tab lives in the URL so a reviewer can link straight to "Compare & resolve".
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const setTab = (id: string) => setParams((p) => { p.set('tab', id); return p; }, { replace: true });

  if (isLoading) return <Loading label="Loading case…" />;
  if (error || !detail) {
    return (
      <>
        <PageHeader title="Case" actions={<Link to="/cases" className="btn">Back to cases</Link>} />
        <ErrorMessage error={error ?? new Error('Case not found')} title="Could not load case" />
      </>
    );
  }

  const invoice = detail.extraction && !('documents' in detail.extraction) ? detail.extraction : null;
  const vendorName = referencesFor(detail).vendor?.name ?? invoice?.vendor_name.value;
  return (
    <>
      <PageHeader
        title={
          <span className="row">
            {vendorName ? `${vendorName} · ` : ''}{detail.invoice_number ?? detail.filename}
            <StatusBadge status={detail.status} />
          </span>
        }
        subtitle={
          <span className="small">
            {detail.email_id != null ? `Inbox email #${detail.email_id}` : 'Uploaded'} · {detail.filename} · received {formatDateTime(detail.created_at)}
            {' · '}<span className="mono">case {shortId(detail.id)} v{detail.version}</span>
          </span>
        }
        actions={
          <>
            <button className="btn" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
            <Link to="/cases" className="btn">Back to cases</Link>
          </>
        }
      />
      <ProcessingBanner detail={detail} />
      <Tabs key={tab} initial={tab} onChange={setTab} tabs={buildTabs(detail, () => setTab('review'))} />
    </>
  );
}
