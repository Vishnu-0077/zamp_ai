import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RETRYABLE_CODES, type CaseDetail } from '@/api/types';
import { Alert, ErrorMessage } from '@/components';
import { useReviewerKey } from '@/lib/reviewerKey';
import { useRetryCase } from '../hooks';

export function canRetry(detail: CaseDetail): boolean {
  const codes = detail.decision?.reason_codes ?? [];
  return detail.status === 'review' && codes.some((c) => (RETRYABLE_CODES as readonly string[]).includes(c));
}

/** Re-queue a case after a processing dependency (OCR/model/config) is repaired. */
export function RetryPanel({ detail }: { detail: CaseDetail }) {
  const [note, setNote] = useState('');
  const reviewerKey = useReviewerKey();
  const mutation = useRetryCase(detail.id);
  if (!canRetry(detail)) return null;
  return (
    <Alert tone="info" title="Processing dependency failure">
      <p style={{ margin: '4px 0 8px' }}>
        This case stopped because of a processing dependency, not a business rule. After fixing the backend configuration
        (OCR, model credentials), retry to re-run extraction.
      </p>
      {!reviewerKey && <p className="small">Requires a reviewer key. Set it in <Link to="/settings">Settings</Link>.</p>}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Retry note, e.g. “Configured EXTRACTION_MODEL”" aria-label="Retry note" />
        <button
          className="btn btn-primary"
          disabled={note.trim().length < 5 || mutation.isPending || !reviewerKey}
          onClick={() => mutation.mutate({ expected_version: detail.version, note: note.trim() }, { onSuccess: () => setNote('') })}
        >
          {mutation.isPending ? 'Retrying…' : 'Retry processing'}
        </button>
      </div>
      <ErrorMessage error={mutation.error} title="Retry failed" />
    </Alert>
  );
}
