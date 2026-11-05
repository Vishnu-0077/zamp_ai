import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { FxRate, PurchaseOrder, Vendor } from '@/api/types';
import { Badge, Card, DataTable, ErrorMessage, JsonView, KeyValue, Loading, PageHeader, Tabs } from '@/components';
import { formatAmount, humanize } from '@/lib/format';

export default function ReferencesPage() {
  const { data, error, isLoading } = useQuery({ queryKey: qk.references, queryFn: systemApi.references });
  const vendorName = (id: string) => data?.vendors.find((v) => v.id === id)?.name ?? id;

  return (
    <>
      <PageHeader title="Reference data" subtitle="Trusted procurement master data and validation policy (read-only)." />
      {error && <ErrorMessage error={error} />}
      {isLoading && <Loading />}
      {data && (
        <Tabs
          tabs={[
            {
              id: 'vendors',
              label: `Vendors (${data.vendors.length})`,
              render: () => (
                <Card>
                  <DataTable<Vendor>
                    rows={data.vendors}
                    rowKey={(v) => v.id}
                    columns={[
                      { key: 'id', header: 'ID', render: (v) => <code>{v.id}</code> },
                      { key: 'name', header: 'Name', render: (v) => v.name },
                      { key: 'domain', header: 'Domain', render: (v) => v.domain ?? '—' },
                      { key: 'approved', header: 'Approved', render: (v) => <Badge tone={v.approved ? 'ok' : 'danger'}>{v.approved ? 'yes' : 'no'}</Badge> },
                      { key: 'terms', header: 'Terms', render: (v) => v.payment_terms ?? '—' },
                      { key: 'currency', header: 'Currency', render: (v) => v.currency ?? '—' },
                      { key: 'bank', header: 'Bank account', render: (v) => <span className="mono">{v.bank_account ?? '—'}</span> },
                    ]}
                  />
                </Card>
              ),
            },
            {
              id: 'pos',
              label: `Purchase orders (${data.purchase_orders.length})`,
              render: () => (
                <Card>
                  <DataTable<PurchaseOrder>
                    rows={data.purchase_orders}
                    rowKey={(p) => p.number}
                    columns={[
                      { key: 'number', header: 'PO', render: (p) => <code>{p.number}</code> },
                      { key: 'vendor', header: 'Vendor', render: (p) => vendorName(p.vendor_id) },
                      { key: 'amount', header: 'Amount', numeric: true, render: (p) => formatAmount(String(p.amount), p.currency) },
                      { key: 'received', header: 'Received', numeric: true, render: (p) => formatAmount(p.received_amount != null ? String(p.received_amount) : null) },
                      { key: 'prev', header: 'Prev. invoiced', numeric: true, render: (p) => formatAmount(p.previously_invoiced != null ? String(p.previously_invoiced) : null) },
                      { key: 'tol', header: 'Tolerance', numeric: true, render: (p) => (p.tolerance_percent != null ? `${p.tolerance_percent}%` : '—') },
                      { key: 'issued', header: 'Issued', render: (p) => p.issue_date ?? '—' },
                    ]}
                  />
                </Card>
              ),
            },
            {
              id: 'fx',
              label: `FX rates (${data.fx_rates?.length ?? 0})`,
              render: () => (
                <Card>
                  <DataTable<FxRate>
                    rows={data.fx_rates ?? []}
                    rowKey={(r) => `${r.from_currency}-${r.to_currency}-${r.date}`}
                    columns={[
                      { key: 'pair', header: 'Pair', render: (r) => `${r.from_currency} → ${r.to_currency}` },
                      { key: 'date', header: 'Date', render: (r) => r.date },
                      { key: 'rate', header: 'Rate', numeric: true, render: (r) => r.rate },
                      { key: 'approved', header: 'Approved', render: (r) => <Badge tone={r.approved ? 'ok' : 'danger'}>{r.approved ? 'yes' : 'no'}</Badge> },
                      { key: 'source', header: 'Source', render: (r) => <span className="small muted">{r.source ?? '—'}</span> },
                    ]}
                  />
                </Card>
              ),
            },
            {
              id: 'policy',
              label: 'Policy',
              render: () => (
                <Card>
                  <KeyValue items={Object.entries(data.policy).map(([k, v]) => [humanize(k), typeof v === 'object' ? <JsonView value={v} /> : String(v)])} />
                </Card>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
