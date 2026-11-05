import type { ExtractedField, InvoiceExtraction, LineItem } from '@/api/types';
import { ConfidenceBadge, DataTable, Empty } from '@/components';
import { formatAmount } from '@/lib/format';
import { LINE_ITEM_FIELDS, groupsFor } from '../fieldConfig';

type Rec = Record<string, ExtractedField<unknown>>;

function Value({ field, decimal }: { field?: ExtractedField<unknown>; decimal?: boolean }) {
  if (!field || field.value === null || field.value === undefined) return <span className="muted">null</span>;
  return <>{decimal ? formatAmount(String(field.value)) : String(field.value)}</>;
}

/** Read-only view of a single invoice extraction, with confidence and evidence. */
export function ExtractionView({ extraction, flagged = new Set<string>() }: { extraction: InvoiceExtraction; flagged?: Set<string> }) {
  const rec = extraction as unknown as Rec;
  return (
    <div className="stack">
      {groupsFor(extraction).map((g) => (
        <section key={g.title}>
          <h3 style={{ marginBottom: 6 }}>{g.title}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Field</th><th>Value</th><th>Confidence</th><th>Evidence</th><th>Page</th></tr>
              </thead>
              <tbody>
                {g.fields.map((f) => {
                  const field = rec[f.key];
                  return (
                    <tr key={f.key} style={flagged.has(f.key) ? { background: 'var(--warn-soft)' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{f.label}{f.critical && <span className="muted" title="Critical field"> *</span>}</td>
                      <td className="wrap"><Value field={field} decimal={f.kind === 'decimal'} /></td>
                      <td>{field && <ConfidenceBadge value={field.confidence} />}</td>
                      <td className="small muted wrap">{field?.evidence ?? '—'}</td>
                      <td>{field?.page ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <section>
        <h3 style={{ marginBottom: 6 }}>Line items ({extraction.line_items.length})</h3>
        <DataTable<{ li: LineItem; i: number }>
          rows={extraction.line_items.map((li, i) => ({ li, i }))}
          rowKey={(r) => r.i}
          empty="No line items extracted."
          columns={LINE_ITEM_FIELDS.map((f) => ({
            key: f.key,
            header: f.label,
            numeric: f.kind === 'decimal',
            render: ({ li }) => {
              const field = (li as unknown as Rec)[f.key];
              return (
                <span title={field?.evidence ? `Evidence (p.${field.page ?? '?'}): ${field.evidence}` : undefined}>
                  <Value field={field} decimal={f.kind === 'decimal'} />{' '}
                  {field && field.confidence !== 'high' && <ConfidenceBadge value={field.confidence} />}
                </span>
              );
            },
          }))}
        />
      </section>
      <section>
        <h3 style={{ marginBottom: 6 }}>Tax components</h3>
        {extraction.tax_components.value?.length ? (
          <DataTable
            rows={extraction.tax_components.value}
            rowKey={(t) => t.name}
            columns={[
              { key: 'name', header: 'Name', render: (t) => t.name },
              { key: 'rate', header: 'Rate', numeric: true, render: (t) => String(t.rate) },
              { key: 'amount', header: 'Amount', numeric: true, render: (t) => formatAmount(String(t.amount)) },
            ]}
          />
        ) : (
          <Empty>None.</Empty>
        )}
      </section>
    </div>
  );
}
