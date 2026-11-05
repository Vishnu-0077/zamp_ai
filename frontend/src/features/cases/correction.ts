/** Pure helpers for the correction workflow (unit-tested in correction.test.ts). */
import type { CaseDetail, ExtractedField, InvoiceExtraction, InvoiceExtractionInput, LineItem, TaxComponent } from '@/api/types';
import { DECIMAL_RE } from '@/lib/format';
import { LINE_ITEM_FIELDS, groupsFor } from './fieldConfig';

export type Draft = InvoiceExtraction;

export function isSingleInvoice(extraction: CaseDetail['extraction']): extraction is InvoiceExtraction {
  return !!extraction && !('documents' in extraction);
}

export function cloneDraft(extraction: InvoiceExtraction): Draft {
  return structuredClone(extraction);
}

export function attestedField<T>(value: T | null): ExtractedField<T> {
  return { value, confidence: 'high', evidence: null, page: null };
}

export function emptyLineItem(): LineItem {
  return {
    description: attestedField<string>(''),
    quantity: attestedField<string>(null),
    unit_price: attestedField<string>(null),
    amount: attestedField<string>(null),
  } as LineItem;
}

export function emptyTaxComponent(): TaxComponent {
  return { name: '', rate: '0', amount: '0' } as TaxComponent;
}

/** Normalise a text input: blank means explicit null, everything else is trimmed. */
export function normalise(input: string): string | null {
  const t = input.trim();
  return t === '' ? null : t;
}

export type DraftErrors = Record<string, string>;

export function validateDraft(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};
  const checkDecimal = (path: string, v: unknown, required = false) => {
    if (v === null || v === undefined || v === '') {
      if (required) errors[path] = 'Required';
      return;
    }
    if (!DECIMAL_RE.test(String(v))) errors[path] = 'Enter a plain decimal number, e.g. 1234.50';
  };
  for (const g of groupsFor(draft)) {
    for (const f of g.fields) {
      if (f.kind === 'decimal') checkDecimal(f.key, (draft as unknown as Record<string, ExtractedField>)[f.key]?.value);
    }
  }
  draft.line_items.forEach((li, i) => {
    for (const f of LINE_ITEM_FIELDS) {
      if (f.kind === 'decimal') checkDecimal(`line_items.${i}.${f.key}`, (li as unknown as Record<string, ExtractedField>)[f.key].value);
    }
  });
  (draft.tax_components.value ?? []).forEach((tc, i) => {
    if (!tc.name.trim()) errors[`tax_components.${i}.name`] = 'Required';
    checkDecimal(`tax_components.${i}.rate`, tc.rate, true);
    checkDecimal(`tax_components.${i}.amount`, tc.amount, true);
  });
  return errors;
}

/** The complete extraction object the corrections endpoint expects. */
export function toCorrectionPayload(draft: Draft): InvoiceExtractionInput {
  return structuredClone(draft) as unknown as InvoiceExtractionInput;
}

/** Field paths whose value differs between original and draft (for the confirmation summary). */
export function changedFields(original: InvoiceExtraction, draft: Draft): string[] {
  const changes: string[] = [];
  const rec = (o: unknown) => o as Record<string, ExtractedField<unknown>>;
  for (const key of Object.keys(draft)) {
    if (key === 'line_items' || key === 'tax_components') continue;
    if (JSON.stringify(rec(original)[key]?.value) !== JSON.stringify(rec(draft)[key]?.value)) changes.push(key);
  }
  if (JSON.stringify(original.line_items) !== JSON.stringify(draft.line_items)) changes.push('line_items');
  if (JSON.stringify(original.tax_components.value) !== JSON.stringify(draft.tax_components.value)) changes.push('tax_components');
  return changes;
}

