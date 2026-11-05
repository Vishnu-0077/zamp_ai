import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { casesApi } from '@/api/endpoints';
import { IN_FLIGHT, type CaseDetail, type InvoiceExtraction, type PageText } from '@/api/types';
import {
  Alert, Card, ErrorMessage, JsonView, KeyValue, Loading, PageHeader, PdfViewer, StatusBadge, Tabs, type TabDef,
} from '@/components';
import { formatAmount, formatDateTime, shortId } from '@/lib/format';
import { STATUS_META } from '@/lib/tones';
import { AuditTimeline } from './components/AuditTimeline';
import { ChecksView } from './components/ChecksView';
import { CorrectionForm } from './components/CorrectionForm';
import { ExtractionView } from './components/ExtractionView';
import { FindingsList } from './components/FindingsList';
import { PagesView } from './components/PagesView';
import { RetryPanel } from './components/RetryPanel';
import { isSingleInvoice } from './correction';
import { useCase } from './hooks';

function DecisionBanner({ detail }: { detail: CaseDetail }) {
  if (IN_FLIGHT.includes(detail.status)) {
    return <Alert tone="info" title={STATUS_META[detail.status].label}>This page refreshes automatically when processing finishes.</Alert>;
  }
  if (!detail.decision) return null;
  const tone = STATUS_META[detail.status].tone;
  return (
    <Alert tone={tone} title={`Decision: ${detail.decision.outcome}`}>
      <div className="wrap">{detail.decision.explanation}</div>
    </Alert>
  );
}

function ReviewTab({ detail, editing, setEditing }: { detail: CaseDetail; editing: boolean; setEditing: (v: boolean) => void }) {
  const extraction = detail.extraction;
  const single = isSingleInvoice(extraction);
  const flagged = new Set(detail.findings.map((f) => f.field).filter(Boolean) as string[]);
  return (
    <div className="split">
      <div className="stack" style={{ minWidth: 0 }}>
        {!editing && (
          <Card title={`Findings (${detail.findings.length})`}>
            <FindingsList findings={detail.findings} />
          </Card>
        )}
        <Card
          title={editing ? 'Correct extraction' : 'Extracted data'}
          actions={
            !editing && detail.status === 'review' && single ? (
              <button className="btn btn-primary" onClick={() => setEditing(true)}>Correct &amp; revalidate</button>
            ) : undefined
          }
        >
          {!extraction && <Alert tone="neutral">No extraction is available for this case.</Alert>}
          {extraction && !single && (
            <>
              <Alert tone="warn" title="Bundled documents">
                This PDF contains {(extraction as { documents: unknown[] }).documents.length} documents. Split the original PDF
                and ingest each document separately; a bundle cannot be attested as one invoice.
              </Alert>
              {(extraction as { documents: InvoiceExtraction[] }).documents.map((d, i) => (
                <details key={i} open={i === 0}>
                  <summary><strong>Document {i + 1}</strong></summary>
                  <ExtractionView extraction={d} />
                </details>
              ))}
            </>
          )}
          {single && (editing
            ? <CorrectionForm key={detail.version} detail={detail} extraction={extraction} onDone={() => setEditing(false)} />
            : <ExtractionView extraction={extraction} flagged={flagged} />)}
        </Card>
      </div>
      <div className="sticky">
        <Card>
          <PdfViewer src={casesApi.documentUrl(detail.id)} />
        </Card>
      </div>
    </div>
  );
}

/**
 * Tabs on the case page. To add a view (e.g. "Payments", "Comments"), append a
 * TabDef here; it receives the full CaseDetail.
 */
function buildTabs(detail: CaseDetail, editing: boolean, setEditing: (v: boolean) => void): TabDef[] {
  return [
    { id: 'review', label: 'Review', render: () => <ReviewTab detail={detail} editing={editing} setEditing={setEditing} /> },
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
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Loading label="Loading case…" />;
  if (error || !detail) {
    return (
      <>
        <PageHeader title="Case" actions={<Link to="/cases" className="btn">Back to cases</Link>} />
        <ErrorMessage error={error ?? new Error('Case not found')} title="Could not load case" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="row">
            {detail.invoice_number ?? detail.filename}
            <StatusBadge status={detail.status} />
          </span>
        }
        subtitle={<span className="mono">Case {shortId(detail.id)} · version {detail.version}</span>}
        actions={
          <>
            <button className="btn" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
            <Link to="/cases" className="btn">Back to cases</Link>
          </>
        }
      />
      <DecisionBanner detail={detail} />
      <RetryPanel detail={detail} />
      <Card>
        <div className="grid grid-2">
          <KeyValue
            items={[
              ['Vendor', detail.vendor_id ?? '—'],
              ['Sender', detail.sender || '—'],
              ['File', detail.filename],
              ['PO', detail.po_number ?? '—'],
            ]}
          />
          <KeyValue
            items={[
              ['Amount', formatAmount(detail.amount, detail.currency)],
              ['Invoice date', detail.invoice_date ?? '—'],
              ['Created', formatDateTime(detail.created_at)],
              ['Updated', formatDateTime(detail.updated_at)],
            ]}
          />
        </div>
        {detail.email_id != null && <p className="small muted" style={{ marginBottom: 0 }}>From inbox email #{detail.email_id} · model {detail.model ?? 'n/a'} · SHA-256 <span className="mono">{detail.hash.slice(0, 16)}…</span></p>}
      </Card>
      <Tabs tabs={buildTabs(detail, editing, setEditing)} />
    </>
  );
}
