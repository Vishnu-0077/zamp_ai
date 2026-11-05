import { useNavigate } from 'react-router-dom';
import type { CaseSummary } from '@/api/types';
import { DataTable, StatusBadge, type Column } from '@/components';
import { formatAmount, formatDateTime } from '@/lib/format';

export const caseColumns: Column<CaseSummary>[] = [
  { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
  {
    key: 'invoice',
    header: 'Invoice',
    render: (c) => (
      <div>
        <div>{c.invoice_number ?? <span className="muted">—</span>}</div>
        <div className="small muted truncate" title={c.filename}>{c.filename}</div>
      </div>
    ),
  },
  { key: 'vendor', header: 'Vendor', render: (c) => c.vendor_id ?? <span className="muted small truncate" title={c.sender}>{c.sender || '—'}</span> },
  { key: 'po', header: 'PO', render: (c) => c.po_number ?? '—' },
  { key: 'amount', header: 'Amount', numeric: true, render: (c) => formatAmount(c.amount, c.currency) },
  {
    key: 'issues',
    header: 'Findings',
    render: (c) =>
      c.findings.length ? (
        <span className="small wrap" title={c.findings.map((f) => f.code).join(', ')}>
          {c.findings[0].code}
          {c.findings.length > 1 && <span className="muted"> +{c.findings.length - 1}</span>}
        </span>
      ) : (
        <span className="muted">—</span>
      ),
  },
  { key: 'updated', header: 'Updated', render: (c) => <span className="small">{formatDateTime(c.updated_at)}</span> },
];

/** Narrow column set for half-width panels such as the dashboard. */
export const compactCaseColumns = caseColumns.filter((c) => ['status', 'invoice', 'amount', 'issues'].includes(c.key));

export function CaseTable({ rows, columns = caseColumns, empty }: { rows: CaseSummary[]; columns?: Column<CaseSummary>[]; empty?: string }) {
  const navigate = useNavigate();
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(c) => c.id}
      onRowClick={(c) => navigate(`/cases/${c.id}`)}
      empty={empty ?? 'No cases yet. Send an inbox email or upload a PDF to start.'}
    />
  );
}
