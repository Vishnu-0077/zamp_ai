import { describe, expect, it } from 'vitest';
import { extraction } from '@/test/fixtures';
import { changedFields, cloneDraft, emptyLineItem, isSingleInvoice, normalise, toCorrectionPayload, validateDraft } from './correction';
import { groupsFor } from './fieldConfig';

describe('correction helpers', () => {
  it('detects bundles', () => {
    expect(isSingleInvoice(extraction())).toBe(true);
    expect(isSingleInvoice({ documents: [extraction(), extraction()] } as never)).toBe(false);
    expect(isSingleInvoice(null)).toBe(false);
  });

  it('treats blank input as explicit null', () => {
    expect(normalise('   ')).toBeNull();
    expect(normalise(' PO-1 ')).toBe('PO-1');
  });

  it('validates decimals in scalar fields, line items and tax components', () => {
    const d = cloneDraft(extraction());
    expect(validateDraft(d)).toEqual({});
    d.total_amount.value = '12,00';
    d.line_items.push(emptyLineItem());
    d.line_items[1].quantity.value = 'two';
    d.tax_components.value = [{ name: '', rate: '9', amount: 'x' } as never];
    expect(Object.keys(validateDraft(d)).sort()).toEqual([
      'line_items.1.quantity', 'tax_components.0.amount', 'tax_components.0.name', 'total_amount',
    ]);
  });

  it('reports changed fields and builds a complete payload', () => {
    const original = extraction();
    const d = cloneDraft(original);
    d.po_reference.value = 'PO-26002';
    d.line_items[0].amount.value = '281.70';
    expect(changedFields(original, d)).toEqual(['po_reference', 'line_items']);
    const payload = toCorrectionPayload(d);
    expect(Object.keys(payload).sort()).toEqual(Object.keys(original).sort());
    expect(original.po_reference.value).toBe('PO-26001'); // original untouched
  });

  it('surfaces unknown backend fields so they remain editable', () => {
    const e = { ...extraction(), payment_reference: { value: 'R1', confidence: 'high', evidence: null, page: null } };
    const groups = groupsFor(e);
    expect(groups.at(-1)).toMatchObject({ title: 'Other fields', fields: [{ key: 'payment_reference' }] });
  });
});
