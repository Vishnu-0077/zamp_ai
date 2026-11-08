import { useState } from 'react';
import { RETRYABLE_CODES, type CaseDetail } from '@/api/types';
import { Alert, Badge, ErrorMessage } from '@/components';
import { isValidName, useReviewerName } from '@/lib/reviewerName';
import { ReviewerNameField } from '../components/ReviewerNameField';
import { useApproveCase } from '../hooks';
import { invoiceOf, issuesFor, referencesFor } from '../overview/insights';

/** Codes the backend refuses to approve over: nothing usable was read yet. */
const UNAPPROVABLE = new Set<string>([...RETRYABLE_CODES, 'MULTIPLE_DOCUMENTS']);

export function canApproveManually(detail: CaseDetail): boolean {
  const codes = detail.decision?.reason_codes ?? [];
  return detail.status === 'review' && !!invoiceOf(detail) && !codes.some((c) => UNAPPROVABLE.has(c.toUpperCase()));
}

/**
 * Approve a held case after checking it by eye. Every open issue must be ticked
 * so nothing is approved unseen; the backend records the override in the audit trail.
 */
export function ManualApprovalForm({ detail }: { detail: CaseDetail }) {
  const issues = issuesFor(detail.findings);
  const codes = [...new Set(detail.decision?.reason_codes ?? [])];
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const reviewer = useReviewerName();
  const mutation = useApproveCase(detail.id);
  const { po } = referencesFor(detail);
  const high = issues.filter((i) => i.severity === 'high');
  const issueKey = (code: string, field: string | null) => `${code}|${field ?? ''}`;
  const allTicked = issues.every((i) => ticked.has(issueKey(i.code, i.field)));
  const ready = allTicked && note.trim().length >= 10 && confirmed && isValidName(reviewer);

  const toggle = (key: string) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) mutation.mutate({ expected_version: detail.version, note: note.trim(), reviewer: reviewer.trim(), acknowledged_codes: codes });
      }}
    >
      <Alert tone="info" title="Approve without re-running the checks">
        Use this when you have compared the invoice with the PO and the PDF yourself and are satisfied it should be paid.
        The values are not changed. Your note and every issue you override are saved in the audit trail.
        {po ? ` ${po.number} will be charged for this invoice.` : ' No purchase order is matched, so no PO budget will be reserved.'}
      </Alert>
      {high.length > 0 && (
        <Alert tone="danger" title={`${high.length} high-risk issue${high.length === 1 ? '' : 's'}`}>
          These are common signs of fraud or overpayment. Confirm them with the vendor or requester through a channel you already trust before approving.
        </Alert>
      )}

      <fieldset className="ack">
        <legend><strong>Tick each issue you checked and accept</strong></legend>
        {issues.map((i) => {
          const key = issueKey(i.code, i.field);
          return (
            <label key={key} className="ack-item">
              <input type="checkbox" checked={ticked.has(key)} onChange={() => toggle(key)} />
              <span>
                <span className="row"><strong>{i.title}</strong>{i.severity === 'high' && <Badge tone="danger">High risk</Badge>}</span>
                <span className="small muted">{i.why}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <ReviewerNameField />
      <label className="field">
        Why is it OK to pay? (required, at least 10 characters)
        <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Called the vendor on the number on file; they confirmed the new bank account." />
      </label>
      <label className="row">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I compared this invoice with the PDF and the purchase order myself, and approve it for payment.
      </label>

      <ErrorMessage error={mutation.error} title="Approval was not accepted" />
      <div className="row">
        <button type="submit" className="btn btn-approve" disabled={!ready || mutation.isPending}>
          {mutation.isPending ? 'Approving…' : 'Approve manually'}
        </button>
        {!allTicked && <span className="small muted">Tick all {issues.length} issue{issues.length === 1 ? '' : 's'} to continue.</span>}
      </div>
    </form>
  );
}
