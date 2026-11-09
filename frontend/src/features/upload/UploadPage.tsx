import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components';
import { InvoiceUpload } from './InvoiceUpload';
import { PurchaseOrderUpload } from './PurchaseOrderUpload';

/** Upload invoices for processing, or add purchase orders they are matched against. */
export default function UploadPage() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <PageHeader title="Upload" subtitle="Send invoices for processing, or add the purchase orders they are checked against." />
      <Tabs
        initial={params.get('tab') ?? undefined}
        onChange={(id) => setParams(id === 'invoice' ? {} : { tab: id }, { replace: true })}
        tabs={[
          { id: 'invoice', label: 'Upload invoice', render: () => <InvoiceUpload /> },
          { id: 'po', label: 'Upload PO', render: () => <PurchaseOrderUpload /> },
        ]}
      />
    </>
  );
}
