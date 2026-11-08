import { useState } from 'react';
import { casesApi } from '@/api/endpoints';
import type { CaseDetail, InvoiceExtraction, PurchaseOrder, Vendor } from '@/api/types';
import { Alert, Badge, Card, PdfViewer } from '@/components';
import { formatAmount } from '@/lib/format';
import { CorrectionForm } from '../components/CorrectionForm';
import { RetryPanel, canRetry } from '../components/RetryPanel';
import { invoiceOf, issuesFor, poProblem, referencesFor, vendorOfPo, vendorPurchaseOrders } from '../overview/insights';
import { ManualApprovalForm, canApproveManually } from './ManualApprovalForm';

function money(amount: unknown, currency?: string | null) {
  return amount === null || amount === undefined || amount === '' ? '—' : formatAmount(String(amount), currency);
}

/** The matched PO, laid out like a purchase order document. */
function PoDocument({ po, vendor, detail }: { po: PurchaseOrder; vendor: Vendor | null; detail: CaseDetail }) {
  const invoice = invoiceOf(detail);
  const invoiceVendor = invoice?.vendor_name.value ?? null;
  const invoiceBank = invoice?.bank_details.value ?? null;
  // The invoice's sender is not this PO's vendor when the backend matched no vendor or a different one.
  const otherSender = !detail.vendor_id || detail.vendor_id !== po.vendor_id;
  const bankDiffers = detail.findings.some((f) => f.code.toUpperCase() === 'BANK_ACCOUNT_CHANGED');
  const match = ((detail.checks ?? {}) as Record<string, Record<string, unknown> | undefined>).po_match ?? {};
  const invoiceTotal = detail.amount;
  const codes = new Set(detail.findings.map((f) => f.code.toUpperCase()));
  const over = codes.has('PO_BALANCE_EXCEEDED') || codes.has('CONVERTED_PO_OVERRUN');
  const overReceived = codes.has('RECEIPT_BALANCE_EXCEEDED');
  const rows: [string, string, boolean?][] = [
    ['PO total', money(po.amount, po.currency)],
    ['Already invoiced', money(po.previously_invoiced ?? 0, po.currency)],
    ['Available for this invoice', money(match.balance ?? null, po.currency), over],
    ['Goods / services received', money(po.received_amount, po.currency)],
    ['Received but not yet billed', money(match.received_balance ?? null, po.currency), overReceived],
  ];
  return (
    <div className="po-doc">
      <div className="po-doc-head">
        <div>
          <span className="eyebrow">Purchase order</span>
          <div className="po-doc-number">{po.number}</div>
        </div>
        <div className="po-doc-meta">
          <div><span className="muted">Issued</span> {po.issue_date ?? '—'}</div>
          <div><span className="muted">Currency</span> {po.currency}</div>
          {po.tolerance_percent !== undefined && <div><span className="muted">Tolerance</span> {po.tolerance_percent}%</div>}
        </div>
      </div>
      <div className="po-doc-section">
        <span className="eyebrow">Raised for vendor</span>
        <div className="po-doc-vendor">{vendor?.name ?? po.vendor_id}</div>
        {otherSender && (
          <div className="po-diff">On the invoice: <strong>{invoiceVendor ?? 'no vendor name'}</strong>. This invoice is not from this PO's vendor.</div>
        )}
        <div className="row small">
          <span className="mono muted">{po.vendor_id}</span>
          {vendor && <Badge tone={vendor.approved === false ? 'danger' : 'ok'}>{vendor.approved === false ? 'Not approved' : 'Approved vendor'}</Badge>}
        </div>
        {vendor && (
          <dl className="po-doc-facts">
            <div>
              <dt>Bank account on file</dt><dd className="mono">{vendor.bank_account ?? '—'}</dd>
              {(bankDiffers || otherSender) && invoiceBank && invoiceBank !== vendor.bank_account && (
                <div className="po-diff">Invoice asks for <span className="mono">{invoiceBank}</span></div>
              )}
            </div>
            <div><dt>Payment terms</dt><dd>{vendor.payment_terms ?? '—'}</dd></div>
          </dl>
        )}
      </div>
      <table className="po-doc-table">
        <tbody>
          {rows.map(([label, val, bad]) => (
            <tr key={label} className={bad ? 'po-bad' : undefined}><td>{label}</td><td className="num">{val}</td></tr>
          ))}
          <tr className="po-this"><td>This invoice</td><td className="num">{money(invoiceTotal, detail.currency)}</td></tr>
        </tbody>
      </table>
      {over && <p className="po-doc-warn">This invoice is more than what's available on the PO.</p>}
    </div>
  );
}

/** Shown when the invoice's PO couldn't be matched; offers the vendor's POs to pick from. */
function PoNotFound({ detail, onPick }: { detail: CaseDetail; onPick?: (number: string) => void }) {
  const { vendor, options } = vendorPurchaseOrders(detail);
  return (
    <div className="po-missing">
      <div className="po-missing-icon" aria-hidden>?</div>
      <h3>Purchase order not found</h3>
      <p className="muted">{poProblem(detail)}</p>
      {options.length > 0 ? (
        <>
          <p className="small" style={{ marginBottom: 6 }}>Open POs for <strong>{vendor?.name}</strong>. Pick the right one to put it on the invoice:</p>
          <ul className="po-options">
            {options.map(({ po, available }) => (
              <li key={po.number}>
                <div>
                  <strong>{po.number}</strong>
                  <div className="small muted">Issued {po.issue_date ?? '—'} · total {money(po.amount, po.currency)} · open on record {money(available, po.currency)}</div>
                </div>
                {onPick && <button type="button" className="btn btn-sm" onClick={() => onPick(po.number)}>Use this PO</button>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="small muted">{vendor ? `${vendor.name} has no purchase orders on record.` : 'The vendor could not be matched either, so no POs can be suggested.'} Ask the requester for the correct PO.</p>
      )}
    </div>
  );
}

type Action = 'correct' | 'approve' | 'retry';

/**
 * Side-by-side check of a case: invoice PDF on the left, purchase order on the
 * right; underneath, the ways to resolve a held case.
 */
export function ComparePanel({ detail }: { detail: CaseDetail }) {
  const invoice = invoiceOf(detail);
  const { po } = referencesFor(detail);
  const vendor = vendorOfPo(detail, po);
  const issues = issuesFor(detail.findings);
  const reviewing = detail.status === 'review';
  const retryable = canRetry(detail);
  const approvable = canApproveManually(detail);
  const [action, setAction] = useState<Action>(retryable && !invoice ? 'retry' : 'correct');
  const [pickedPo, setPickedPo] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const pick = (number: string) => {
    setPickedPo(number);
    setAction('correct');
    document.getElementById('resolve')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const actions: { id: Action; label: string; hint: string; show: boolean }[] = [
    { id: 'correct', label: 'Correct values & re-check', hint: 'Fix or fill in values, then every rule runs again.', show: !!invoice },
    { id: 'approve', label: 'Approve manually', hint: 'You checked it yourself and it is fine to pay.', show: approvable },
    { id: 'retry', label: 'Retry processing', hint: 'Read the PDF again after fixing OCR or the model.', show: retryable },
  ];

  return (
    <div className="stack">
      {reviewing && issues.length > 0 && (
        <div className="issue-strip" role="note">
          <strong>Look for:</strong>
          {issues.map((i) => <Badge key={`${i.code}-${i.field}`} tone={i.severity === 'high' ? 'danger' : 'warn'}>{i.title}</Badge>)}
        </div>
      )}
      <div className="compare">
        <Card className="compare-pane" title={<span className="row">Invoice <span className="muted small">as received</span></span>}>
          <PdfViewer src={casesApi.documentUrl(detail.id)} title="Invoice PDF" />
        </Card>
        <Card className="compare-pane" title={<span className="row">Purchase order {!po ? <Badge tone="danger">Not found</Badge>
            : detail.vendor_id === po.vendor_id ? <Badge tone="ok">Matched</Badge> : <Badge tone="danger">Other vendor's PO</Badge>}</span>}>
          {po ? <PoDocument po={po} vendor={vendor} detail={detail} /> : <PoNotFound detail={detail} onPick={reviewing && invoice ? pick : undefined} />}
        </Card>
      </div>

      {!invoice && detail.extraction && (
        <Alert tone="warn" title="Several documents in one PDF">
          Split the original PDF and upload each document separately; a bundle can't be corrected or approved as one invoice.
        </Alert>
      )}

      {reviewing && actions.some((a) => a.show) && (
        <Card title="Resolve this case" className="resolve">
          <div id="resolve" className="choice" role="radiogroup" aria-label="How to resolve">
            {actions.filter((a) => a.show).map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={action === a.id} className="choice-btn" onClick={() => setAction(a.id)}>
                <strong>{a.label}</strong>
                <span className="small muted">{a.hint}</span>
              </button>
            ))}
          </div>
          {action === 'correct' && invoice && (
            <CorrectionForm
              key={`${detail.version}-${formKey}`}
              detail={detail}
              extraction={invoice as InvoiceExtraction}
              pickedPo={pickedPo}
              onDone={() => { setPickedPo(null); setFormKey((k) => k + 1); }}
            />
          )}
          {action === 'approve' && approvable && <ManualApprovalForm key={detail.version} detail={detail} />}
          {action === 'retry' && <RetryPanel detail={detail} />}
        </Card>
      )}
    </div>
  );
}
