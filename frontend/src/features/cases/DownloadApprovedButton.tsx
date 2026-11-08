import { exportsApi } from '@/api/endpoints';
import { useStats } from './hooks';

/** Downloads the always-current Excel register of approved invoices. */
export function DownloadApprovedButton({ primary = false }: { primary?: boolean }) {
  const approved = useStats().data?.counts.approved;
  return (
    <a
      className={`btn${primary ? ' btn-primary' : ''}`}
      href={exportsApi.approvedInvoicesUrl()}
      download
      title="Excel workbook of every approved invoice: summary, invoices and line items. Always up to date."
    >
      ⬇ Approved invoices (Excel){approved !== undefined ? ` · ${approved}` : ''}
    </a>
  );
}
