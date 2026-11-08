import { useState } from 'react';
import { RETRYABLE_CODES, type CaseDetail } from '@/api/types';
import { Alert, ErrorMessage } from '@/components';
import { isValidName, useReviewerName } from '@/lib/reviewerName';
import { ReviewerNameField } from './ReviewerNameField';
import { useRetryCase } from '../hooks';

export function canRetry(detail: CaseDetail): boolean {
  const codes = detail.decision?.reason_codes ?? [];
  return detail.status === 'review' && codes.some((c) => (RETRYABLE_CODES as readonly string[]).includes(c));
}

/** Re-queue a case after a processing dependency (OCR/model/config) is repaired. */
export function RetryPanel({ detail }: { detail: CaseDetail }) {
  const [note, setNote] = useState('');
  const reviewer = useReviewerName();
  const mutation = useRetryCase(detail.id);
  if (!canRetry(detail)) return null;
  return (
    <Alert tone="info" title="Processing dependency failure">
      <p style={{ margin: '4px 0 8px' }}>
        This case stopped because of a processing dependency, not a business rule. After fixing the backend configuration
        (OCR, model credentials), retry to re-run extraction.
      </p>
      <ReviewerNameField />
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Retry note, e.g. “Configured EXTRACTION_MODEL”" aria-label="Retry note" />
        <button
          className="btn btn-primary"
          disabled={note.trim().length < 5 || mutation.isPending || !isValidName(reviewer)}
          onClick={() => mutation.mutate({ expected_version: detail.version, note: note.trim(), reviewer: reviewer.trim() }, { onSuccess: () => setNote('') })}
        >
          {mutation.isPending ? 'Retrying…' : 'Retry processing'}
        </button>
      </div>
      <ErrorMessage error={mutation.error} title="Retry failed" />
    </Alert>
  );
}
