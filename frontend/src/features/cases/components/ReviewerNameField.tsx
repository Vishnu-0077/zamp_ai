import { setReviewerName, useReviewerName } from '@/lib/reviewerName';

/** "Your name" input shared by the review actions; remembered in this browser. */
export function ReviewerNameField() {
  const name = useReviewerName();
  return (
    <label className="field" style={{ maxWidth: 320 }}>
      Your name
      <input
        value={name}
        maxLength={80}
        autoComplete="name"
        placeholder="e.g. Priya Sharma"
        onChange={(e) => setReviewerName(e.target.value)}
        className={name && name.trim().length < 2 ? 'invalid' : undefined}
      />
      <span className="small muted" style={{ fontWeight: 400 }}>Saved in the audit trail and the approved-invoices Excel.</span>
    </label>
  );
}
