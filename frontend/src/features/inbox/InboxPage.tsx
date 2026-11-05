import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi, ingestApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { IngestResult } from '@/api/types';
import { Alert, Card, Empty, ErrorMessage, KeyValue, Loading, PageHeader, PdfViewer, StatusBadge } from '@/components';
import { shortId } from '@/lib/format';

function IngestOutcome({ result }: { result: IngestResult }) {
  return (
    <Alert tone={result.duplicate_submission ? 'warn' : 'ok'} title={result.duplicate_submission ? 'Already submitted' : 'Queued for processing'}>
      <span className="row">
        Case <Link to={`/cases/${result.id}`} className="mono">{shortId(result.id)}</Link>
        <StatusBadge status={result.status} />
        {result.duplicate_submission && <span className="small">Identical PDF: the existing case was reused and the submission recorded.</span>}
      </span>
    </Alert>
  );
}

function EmailReader({ id }: { id: number }) {
  const client = useQueryClient();
  const preview = useQuery({ queryKey: qk.inbox.preview(id), queryFn: () => inboxApi.preview(id) });
  const ingest = useMutation({
    mutationFn: () => ingestApi.email(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['cases'] });
      client.invalidateQueries({ queryKey: ['stats'] });
    },
  });
  if (preview.isLoading) return <Loading label="Loading message…" />;
  if (preview.error) return <ErrorMessage error={preview.error} />;
  const e = preview.data!;
  return (
    <>
      <Card
        title={e.subject}
        actions={
          <button className="btn btn-primary" onClick={() => ingest.mutate()} disabled={ingest.isPending}>
            {ingest.isPending ? 'Sending…' : 'Send to processing'}
          </button>
        }
      >
        {ingest.data && <IngestOutcome result={ingest.data} />}
        <ErrorMessage error={ingest.error} title="Could not queue this email" />
        <KeyValue items={[['From', e.from], ['To', e.to], ['Date', e.date]]} />
        <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', marginTop: 16 }} className="wrap">{e.body}</pre>
        <a href={inboxApi.rawUrl(id)} className="small">Download .eml</a>
      </Card>
      <Card>
        <PdfViewer src={inboxApi.attachmentUrl(id)} title="Invoice attachment" />
      </Card>
    </>
  );
}

export default function InboxPage() {
  const { data, error, isLoading } = useQuery({ queryKey: qk.inbox.list, queryFn: inboxApi.list });
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data ?? []).filter((e) => `${e.sender} ${e.subject}`.toLowerCase().includes(q));
  }, [data, search]);
  const current = selected ?? filtered[0]?.id ?? null;

  return (
    <>
      <PageHeader title="Vendor inbox" subtitle="Emails received from vendors. Send an invoice attachment into processing." />
      {error && <ErrorMessage error={error} title="Could not load inbox" />}
      <div className="split" style={{ gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)' }}>
        <Card className="sticky">
          <input type="search" placeholder="Search sender or subject…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search inbox" />
          <p className="small muted" role="status">{isLoading ? 'Loading…' : `${filtered.length} of ${data?.length ?? 0} emails`}</p>
          <nav aria-label="Emails" style={{ maxHeight: '70vh', overflow: 'auto', margin: '0 -24px -24px' }}>
            {filtered.map((e) => (
              <button key={e.id} className="list-btn" aria-current={e.id === current} onClick={() => setSelected(e.id)}>
                <div><strong>{e.sender.split('@')[1] ?? e.sender}</strong></div>
                <div className="small wrap">{e.subject}</div>
                <div className="small muted">Message {String(e.id).padStart(2, '0')}</div>
              </button>
            ))}
            {!isLoading && !filtered.length && <Empty>No matching emails.</Empty>}
          </nav>
        </Card>
        <div style={{ minWidth: 0 }}>{current != null ? <EmailReader key={current} id={current} /> : <Empty>Select an email.</Empty>}</div>
      </div>
    </>
  );
}
