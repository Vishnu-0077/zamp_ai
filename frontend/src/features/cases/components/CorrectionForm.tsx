import { useEffect, useMemo, useState } from 'react';
import type { CaseDetail, ExtractedField, InvoiceExtraction } from '@/api/types';
import { Alert, ConfidenceBadge, ErrorMessage } from '@/components';
import { isValidName, useReviewerName } from '@/lib/reviewerName';
import { ReviewerNameField } from './ReviewerNameField';
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
  pickedPo = null,
}: {
  detail: CaseDetail;
  extraction: InvoiceExtraction;
  onDone: () => void;
  /** A PO chosen in the purchase-order panel; written into the PO reference field. */
  pickedPo?: string | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => cloneDraft(extraction));
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const reviewer = useReviewerName();
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

  useEffect(() => {
    if (pickedPo) update((d) => { d.po_reference.value = pickedPo; });
  }, [pickedPo]);

  const missing = groupsFor(draft).flatMap((g) => g.fields)
    .filter((f) => f.critical && (draft as unknown as Rec)[f.key]?.value == null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length || note.trim().length < 5 || !attested || !isValidName(reviewer)) return;
    mutation.mutate(
      { expected_version: detail.version, note: note.trim(), reviewer: reviewer.trim(), extraction: toCorrectionPayload(draft) },
      { onSuccess: onDone },
    );
  };

  const err = (path: string) => (showErrors ? errors[path] : undefined);

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <Alert tone="info" title="Fix the values, then every check runs again">
        Compare each field with the invoice PDF above, correct anything misread and fill in what's missing. When you save,
        the vendor, bank, PO, duplicate and math checks all run again. If everything passes the invoice is approved;
        otherwise it stays here with the remaining issues. Leave a box empty only if the value really isn't on the invoice.
      </Alert>
      {missing.length > 0 && (
        <Alert tone="warn" title={`${missing.length} important value${missing.length === 1 ? ' is' : 's are'} missing`}>
          {missing.map((f) => f.label).join(', ')}. Type them in from the PDF if they are printed there.
        </Alert>
      )}
      {pickedPo && <Alert tone="ok" title={`PO reference set to ${pickedPo}`}>Save to re-check the invoice against this purchase order.</Alert>}

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
              const isMissing = f.critical && field?.value == null;
              return (
                <label key={f.key} className={`field${isMissing ? ' field-missing' : ''}`}>
                  <span className="row">
                    {f.label}
                    {isMissing && <span className="badge tone-danger">missing</span>}
                    {flagged.has(f.key) && <span className="badge tone-warn">flagged</span>}
                    {original && <ConfidenceBadge value={original.confidence} />}
                  </span>
                  <Input
                    value={value}
                    inputMode={f.kind === 'decimal' ? 'decimal' : undefined}
                    className={e ? 'invalid' : undefined}
                    aria-invalid={!!e}
                    onChange={(ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setScalar(f.key, ev.target.value)}
                    placeholder={isMissing ? 'Not found. Type it from the PDF' : 'Not on the invoice'}
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
        <ReviewerNameField />
        <label className="field" style={{ marginTop: 10 }}>
          What did you change and why? (required)
          <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. OCR read the total as 3,840; the PDF shows 3,740." className={showErrors && note.trim().length < 5 ? 'invalid' : undefined} />
        </label>
        <label className="row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          I checked every value above, including empty ones and line items, against the invoice PDF.
        </label>
        <p className="small muted">
          {changes.length ? `You changed: ${changes.join(', ')}` : 'No values changed yet. Saving will confirm the values as they are and re-run the checks.'}
        </p>
        {showErrors && Object.keys(errors).length > 0 && <Alert tone="danger">Fix {Object.keys(errors).length} invalid value(s) before submitting.</Alert>}
        <ErrorMessage error={mutation.error} title="Correction was not accepted" />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !isValidName(reviewer)}>
            {mutation.isPending ? 'Re-checking…' : 'Save corrections & re-check'}
          </button>
          <button type="button" className="btn" onClick={onDone} disabled={mutation.isPending}>Undo my changes</button>
        </div>
      </div>
    </form>
  );
}
