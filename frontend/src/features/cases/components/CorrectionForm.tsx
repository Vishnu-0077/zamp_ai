import { useMemo, useState } from 'react';
import type { CaseDetail, ExtractedField, InvoiceExtraction } from '@/api/types';
import { Alert, ConfidenceBadge, ErrorMessage } from '@/components';
import { useReviewerKey } from '@/lib/reviewerKey';
import { Link } from 'react-router-dom';
import {
  changedFields,
  cloneDraft,
  emptyLineItem,
  emptyTaxComponent,
  normalise,
  toCorrectionPayload,
  validateDraft,
  type Draft,
} from '../correction';
import { LINE_ITEM_FIELDS, groupsFor } from '../fieldConfig';
import { useCorrectCase } from '../hooks';

type Rec = Record<string, ExtractedField<unknown>>;

export function CorrectionForm({
  detail,
  extraction,
  onDone,
}: {
  detail: CaseDetail;
  extraction: InvoiceExtraction;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => cloneDraft(extraction));
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const reviewerKey = useReviewerKey();
  const mutation = useCorrectCase(detail.id);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const changes = useMemo(() => changedFields(extraction, draft), [extraction, draft]);
  const flagged = new Set(detail.findings.map((f) => f.field).filter(Boolean) as string[]);

  const update = (fn: (d: Draft) => void) =>
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  const setScalar = (key: string, raw: string) => update((d) => { (d as unknown as Rec)[key].value = normalise(raw); });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length || note.trim().length < 5 || !attested) return;
    mutation.mutate(
      { expected_version: detail.version, note: note.trim(), extraction: toCorrectionPayload(draft) },
      { onSuccess: onDone },
    );
  };

  const err = (path: string) => (showErrors ? errors[path] : undefined);

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <Alert tone="info" title="Submitting attests every value below">
        Check each field against the source document. Blank inputs are sent as explicit <code>null</code>. Validation,
        vendor, duplicate, PO and math rules rerun on the server. The case may stay in review.
      </Alert>
      {!reviewerKey && (
        <Alert tone="warn" title="Reviewer key required">
          Set your reviewer key in <Link to="/settings">Settings</Link> before submitting.
        </Alert>
      )}

      {groupsFor(draft).map((g) => (
        <fieldset key={g.title} className="card" style={{ margin: 0 }}>
          <legend><strong>{g.title}</strong></legend>
          <div className="grid grid-2">
            {g.fields.map((f) => {
              const field = (draft as unknown as Rec)[f.key];
              const original = (extraction as unknown as Rec)[f.key];
              const value = field?.value == null ? '' : String(field.value);
              const e = err(f.key);
              const Input = f.multiline ? 'textarea' : 'input';
              return (
                <label key={f.key} className="field">
                  <span className="row">
                    {f.label}
                    {flagged.has(f.key) && <span className="badge tone-warn">flagged</span>}
                    {original && <ConfidenceBadge value={original.confidence} />}
                  </span>
                  <Input
                    value={value}
                    inputMode={f.kind === 'decimal' ? 'decimal' : undefined}
                    className={e ? 'invalid' : undefined}
                    aria-invalid={!!e}
                    onChange={(ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setScalar(f.key, ev.target.value)}
                    placeholder="null"
                  />
                  {original?.evidence && <span className="small muted wrap" style={{ fontWeight: 400 }}>Evidence p.{original.page ?? '?'}: “{original.evidence}”</span>}
                  {e && <span className="small" style={{ color: 'var(--danger)' }}>{e}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <fieldset className="card" style={{ margin: 0 }}>
        <legend><strong>Line items</strong></legend>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{LINE_ITEM_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}<th /></tr>
            </thead>
            <tbody>
              {draft.line_items.map((li, i) => (
                <tr key={i}>
                  {LINE_ITEM_FIELDS.map((f) => {
                    const field = (li as unknown as Rec)[f.key];
                    const e = err(`line_items.${i}.${f.key}`);
                    return (
                      <td key={f.key} style={{ minWidth: f.key === 'description' ? 220 : 100 }}>
                        <input
                          aria-label={`Line ${i + 1} ${f.label}`}
                          value={field.value == null ? '' : String(field.value)}
                          className={e ? 'invalid' : undefined}
                          title={e}
                          onChange={(ev) => update((d) => { (d.line_items[i] as unknown as Rec)[f.key].value = normalise(ev.target.value); })}
                        />
                      </td>
                    );
                  })}
                  <td>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => update((d) => { d.line_items.splice(i, 1); })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => update((d) => { d.line_items.push(emptyLineItem()); })}>
          + Add line item
        </button>
      </fieldset>

      <fieldset className="card" style={{ margin: 0 }}>
        <legend><strong>Tax components</strong></legend>
        {(draft.tax_components.value ?? []).map((tc, i) => (
          <div key={i} className="row" style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
            {(['name', 'rate', 'amount'] as const).map((k) => (
              <input
                key={k}
                aria-label={`Tax component ${i + 1} ${k}`}
                placeholder={k}
                value={String(tc[k] ?? '')}
                className={err(`tax_components.${i}.${k}`) ? 'invalid' : undefined}
                onChange={(ev) => update((d) => { (d.tax_components.value![i] as Record<string, unknown>)[k] = ev.target.value.trim(); })}
              />
            ))}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => update((d) => {
              d.tax_components.value!.splice(i, 1);
              if (!d.tax_components.value!.length) d.tax_components.value = null;
            })}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => update((d) => { d.tax_components.value = [...(d.tax_components.value ?? []), emptyTaxComponent()]; })}>
          + Add tax component
        </button>
      </fieldset>

      <div className="card" style={{ margin: 0 }}>
        <label className="field">
          Reviewer note (required, 5–2000 characters)
          <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What did you check and change?" className={showErrors && note.trim().length < 5 ? 'invalid' : undefined} />
        </label>
        <label className="row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          I visually checked every submitted field, including nulls and line items, against the source PDF.
        </label>
        <p className="small muted">
          {changes.length ? `Changed: ${changes.join(', ')}` : 'No values changed. Submitting will attest the extraction as-is.'}
        </p>
        {showErrors && Object.keys(errors).length > 0 && <Alert tone="danger">Fix {Object.keys(errors).length} invalid value(s) before submitting.</Alert>}
        <ErrorMessage error={mutation.error} title="Correction was not accepted" />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !reviewerKey}>
            {mutation.isPending ? 'Submitting…' : 'Submit correction'}
          </button>
          <button type="button" className="btn" onClick={onDone} disabled={mutation.isPending}>Cancel</button>
        </div>
      </div>
    </form>
  );
}
