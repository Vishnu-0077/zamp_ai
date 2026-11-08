import type { CaseDetail, ExtractedField, InvoiceExtraction, LineItem } from '@/api/types';
import { Alert, Badge, Card, Empty } from '@/components';
import { formatAmount } from '@/lib/format';
import { ExtractionView } from '../components/ExtractionView';
import {
  approvalChecklist, comparisonRows, invoiceOf, issuesFor, productSummary, referencesFor,
  type ComparisonRow, type Issue, type RowStatus,
} from './insights';

const ROW_BADGE: Record<RowStatus, { tone: 'ok' | 'danger' | 'neutral'; label: string }> = {
  ok: { tone: 'ok', label: '✓ Matches' },
  issue: { tone: 'danger', label: '✕ Problem' },
  missing: { tone: 'neutral', label: '— Not available' },
  info: { tone: 'neutral', label: 'Info' },
};

function v(field: unknown): string | null {
  const f = field as ExtractedField<unknown> | undefined;
  return f?.value === null || f?.value === undefined ? null : String(f.value);
}

/** Key facts a reviewer needs first: who, what, how much, which PO, when. */
function AtAGlance({ detail, invoice }: { detail: CaseDetail; invoice: InvoiceExtraction | null }) {
  const { vendor } = referencesFor(detail);
  const currency = v(invoice?.currency) ?? detail.currency;
  const total = formatAmount(v(invoice?.total_amount) ?? detail.amount, currency);
  const facts: [string, string][] = [
    ['Invoice number', v(invoice?.invoice_number) ?? detail.invoice_number ?? '—'],
    ['Purchase order', v(invoice?.po_reference) ?? detail.po_number ?? '—'],
    ['Invoice date', v(invoice?.invoice_date) ?? detail.invoice_date ?? '—'],
    ['Due date', v(invoice?.due_date) ?? '—'],
  ];
  return (
    <Card className="glance">
      <div className="glance-main">
        <div className="glance-who">
          <span className="eyebrow">Vendor</span>
          <div className="glance-vendor">{vendor?.name ?? v(invoice?.vendor_name) ?? 'Unknown vendor'}</div>
          <div className="row small muted">
            {vendor ? <span className="mono">{vendor.id}</span> : <span>Not matched to a vendor record</span>}
            {vendor && <Badge tone={vendor.approved === false ? 'danger' : 'ok'}>{vendor.approved === false ? 'Not approved' : 'Approved vendor'}</Badge>}
          </div>
          <div className="glance-product">
            <span className="eyebrow">What was bought</span>
            <div>{productSummary(invoice) ?? <span className="muted">No line items</span>}</div>
          </div>
        </div>
        <div className="glance-amount">
          <span className="eyebrow">Amount due</span>
          <div className="glance-total">{total}</div>
          {v(invoice?.document_type) && <div className="small muted">{v(invoice?.document_type)}</div>}
        </div>
      </div>
      <dl className="glance-facts">
        {facts.map(([k, val]) => (
          <div key={k}><dt>{k}</dt><dd>{val}</dd></div>
        ))}
      </dl>
    </Card>
  );
}

function IssueCard({ issue, index }: { issue: Issue; index: number }) {
  return (
    <li className={`issue issue-${issue.severity}`}>
      <div className="issue-num" aria-hidden>{index + 1}</div>
      <div className="issue-body">
        <div className="row">
          <strong>{issue.title}</strong>
          {issue.severity === 'high' && <Badge tone="danger">High risk</Badge>}
          {issue.count > 1 && <Badge tone="neutral">×{issue.count}</Badge>}
        </div>
        <p>{issue.why}</p>
        <p className="issue-action"><span>What to do:</span> {issue.action}</p>
        <span className="small muted mono">{issue.code}</span>
      </div>
    </li>
  );
}

function ReviewReasons({ detail, onReview }: { detail: CaseDetail; onReview?: () => void }) {
  const issues = issuesFor(detail.findings);
  return (
    <Card
      className="reasons tone-border-warn"
      title={<span className="row">Why this needs your review <Badge tone="warn">{issues.length} issue{issues.length === 1 ? '' : 's'}</Badge></span>}
      actions={onReview && <button className="btn btn-primary" onClick={onReview}>Compare with PDF &amp; resolve →</button>}
    >
      {issues.length ? <ol className="issues">{issues.map((i, n) => <IssueCard key={`${i.code}-${i.field}`} issue={i} index={n} />)}</ol>
        : <Empty>No specific issues were recorded.</Empty>}
    </Card>
  );
}

function ManualApproval({ detail }: { detail: CaseDetail }) {
  const issues = issuesFor(detail.findings);
  const note = (detail.decision?.explanation ?? '').replace(/^Approved manually by a reviewer:\s*/, '');
  return (
    <Card className="reasons tone-border-ok" title={<span className="row">Approved manually <Badge tone="info">By a reviewer</Badge></span>}>
      <p style={{ marginTop: 0 }}>A reviewer checked this invoice against the PDF and the purchase order and approved it, overriding {issues.length} issue{issues.length === 1 ? '' : 's'}.</p>
      <blockquote className="reviewer-note">“{note}”</blockquote>
      <span className="eyebrow">Issues the reviewer accepted</span>
      <ul className="overridden">
        {issues.map((i) => <li key={`${i.code}-${i.field}`}><span className="tick tick-muted" aria-hidden>!</span>{i.title}</li>)}
      </ul>
      <p className="small muted" style={{ marginBottom: 0 }}>Who approved it and when is recorded in the Audit trail tab.</p>
    </Card>
  );
}

function ApprovalReasons({ detail }: { detail: CaseDetail }) {
  if (detail.decision?.manual_override) return <ManualApproval detail={detail} />;
  const { vendor, po } = referencesFor(detail);
  return (
    <Card className="reasons tone-border-ok" title={<span className="row">Why this was approved <Badge tone="ok">All checks passed</Badge></span>}>
      <ul className="checklist">
        {approvalChecklist(detail, vendor, po).map((c) => (
          <li key={c.label}><span className="tick" aria-hidden>✓</span><div><strong>{c.label}</strong><div className="muted">{c.detail}</div></div></li>
        ))}
      </ul>
      <p className="small muted" style={{ marginBottom: 0 }}>The PO value for this invoice is reserved, so it can't be spent twice.</p>
    </Card>
  );
}

function DuplicateReason({ detail }: { detail: CaseDetail }) {
  return (
    <Alert tone="danger" title="This invoice was already processed">
      {detail.decision?.explanation ?? 'An identical invoice already exists.'} Do not pay it again.
    </Alert>
  );
}

function ComparisonCell({ main, note }: { main: string; note?: string }) {
  return <div><div className="wrap cmp-value">{main}</div>{note && <div className="small muted">{note}</div>}</div>;
}

/** Invoice vs PO / vendor master, side by side. */
function Comparison({ rows, poNumber }: { rows: ComparisonRow[]; poNumber: string | null }) {
  const problems = rows.filter((r) => r.status === 'issue').length;
  return (
    <Card title={<span className="row">Invoice vs purchase order {problems ? <Badge tone="danger">{problems} mismatch{problems === 1 ? '' : 'es'}</Badge> : <Badge tone="ok">Everything lines up</Badge>}</span>}>
      <div className="table-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th style={{ width: '18%' }}>What we compare</th>
              <th>On the invoice</th>
              <th>On the {poNumber ? `PO (${poNumber})` : 'PO'} / vendor record</th>
              <th style={{ width: '16%' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`cmp-${r.status}`}>
                <th scope="row">{r.label}</th>
                <td><ComparisonCell main={r.invoice} /></td>
                <td><ComparisonCell main={r.reference} note={r.referenceNote} /></td>
                <td>
                  <Badge tone={ROW_BADGE[r.status].tone}>{ROW_BADGE[r.status].label}</Badge>
                  {r.issues.map((i) => <div key={i.code} className="small cmp-why">{i.title}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LineItemsCard({ invoice }: { invoice: InvoiceExtraction }) {
  const currency = v(invoice.currency);
  const money = (x: unknown) => formatAmount(v(x), currency);
  return (
    <Card title={`What was bought (${invoice.line_items.length} item${invoice.line_items.length === 1 ? '' : 's'})`}>
      {invoice.line_items.length === 0 ? <Empty>No line items were found on the invoice.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {invoice.line_items.map((li: LineItem, i) => (
                <tr key={i}>
                  <td className="wrap">{v(li.description) ?? '—'}</td>
                  <td className="num">{v(li.quantity) ?? '—'}</td>
                  <td className="num">{money(li.unit_price)}</td>
                  <td className="num">{money(li.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className="num muted">Subtotal</td><td className="num">{money(invoice.subtotal)}</td></tr>
              <tr><td colSpan={3} className="num muted">Tax{v(invoice.tax_rate) ? ` (${v(invoice.tax_rate)}%)` : ''}</td><td className="num">{money(invoice.tax)}</td></tr>
              <tr className="total-row"><td colSpan={3} className="num">Total</td><td className="num">{money(invoice.total_amount)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Human-first summary of a case: key facts, then why it was approved or held,
 * then the invoice/PO comparison, then line items, then every verified field.
 */
export function CaseOverview({ detail, onReview }: { detail: CaseDetail; onReview?: () => void }) {
  const invoice = invoiceOf(detail);
  const { vendor, po } = referencesFor(detail);
  const flagged = new Set(detail.findings.map((f) => f.field).filter(Boolean) as string[]);
  return (
    <div className="stack overview">
      <AtAGlance detail={detail} invoice={invoice} />
      {detail.status === 'review' && <ReviewReasons detail={detail} onReview={onReview} />}
      {detail.status === 'approved' && <ApprovalReasons detail={detail} />}
      {detail.status === 'duplicate' && <DuplicateReason detail={detail} />}
      {!invoice && detail.extraction && (
        <Alert tone="warn" title="Several documents in one PDF">Open “Document &amp; correction” to see each document.</Alert>
      )}
      {invoice && <Comparison rows={comparisonRows(detail, vendor, po)} poNumber={po?.number ?? null} />}
      {invoice && <LineItemsCard invoice={invoice} />}
      {invoice && (
        <Card>
          <details>
            <summary><strong>All verified details</strong> <span className="muted small">— every value read from the invoice, how sure we are, and where it was found</span></summary>
            <div style={{ marginTop: 12 }}><ExtractionView extraction={invoice} flagged={flagged} /></div>
          </details>
        </Card>
      )}
    </div>
  );
}
