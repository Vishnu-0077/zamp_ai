/**
 * Presentation metadata for extraction fields. Unknown fields returned by a
 * newer backend are still shown (in "Other fields") and editable as text,
 * so this file is a refinement, not a gate.
 */
export type FieldKind = 'text' | 'decimal';

export interface FieldMeta {
  key: string;
  label: string;
  kind: FieldKind;
  critical?: boolean;
  multiline?: boolean;
}

export interface FieldGroup {
  title: string;
  fields: FieldMeta[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Document',
    fields: [
      { key: 'document_type', label: 'Document type', kind: 'text' },
      { key: 'invoice_number', label: 'Invoice number', kind: 'text', critical: true },
      { key: 'original_invoice', label: 'Original invoice ref.', kind: 'text' },
      { key: 'invoice_date', label: 'Invoice date', kind: 'text', critical: true },
      { key: 'due_date', label: 'Due date', kind: 'text', critical: true },
    ],
  },
  {
    title: 'Vendor & payment',
    fields: [
      { key: 'vendor_name', label: 'Vendor name', kind: 'text', critical: true },
      { key: 'po_reference', label: 'PO reference', kind: 'text', critical: true },
      { key: 'currency', label: 'Currency', kind: 'text', critical: true },
      { key: 'bank_details', label: 'Bank details', kind: 'text', critical: true, multiline: true },
    ],
  },
  {
    title: 'Amounts',
    fields: [
      { key: 'subtotal', label: 'Subtotal', kind: 'decimal', critical: true },
      { key: 'tax', label: 'Tax', kind: 'decimal', critical: true },
      { key: 'total_amount', label: 'Total amount', kind: 'decimal', critical: true },
    ],
  },
  {
    title: 'Tax profile',
    fields: [
      { key: 'tax_profile', label: 'Tax profile', kind: 'text' },
      { key: 'tax_rate', label: 'Tax rate', kind: 'decimal' },
      { key: 'supplier_state', label: 'Supplier state', kind: 'text' },
      { key: 'place_of_supply', label: 'Place of supply', kind: 'text' },
    ],
  },
];

/** Fields rendered by dedicated editors rather than the scalar grid. */
export const STRUCTURED_FIELDS = new Set(['line_items', 'tax_components']);

const KNOWN = new Set(FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

/** Groups for a concrete extraction object, including any unknown scalar fields. */
export function groupsFor(extraction: object): FieldGroup[] {
  const extra = Object.entries(extraction)
    .filter(([k, v]) => !KNOWN.has(k) && !STRUCTURED_FIELDS.has(k) && v && typeof v === 'object' && 'value' in v)
    .map(([k]) => ({ key: k, label: k.replace(/_/g, ' '), kind: 'text' as const }));
  const groups = FIELD_GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => f.key in extraction) }));
  return extra.length ? [...groups, { title: 'Other fields', fields: extra }] : groups;
}

export const LINE_ITEM_FIELDS: FieldMeta[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'quantity', label: 'Qty', kind: 'decimal' },
  { key: 'unit_price', label: 'Unit price', kind: 'decimal' },
  { key: 'amount', label: 'Amount', kind: 'decimal' },
];
