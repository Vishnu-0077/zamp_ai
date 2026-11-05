import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ingestApi } from '@/api/endpoints';
import type { IngestResult } from '@/api/types';
import { Alert, Card, DataTable, PageHeader, StatusBadge } from '@/components';
import { shortId } from '@/lib/format';

const MAX_PDF = 20 * 1024 * 1024;
const MAX_EML = 40 * 1024 * 1024;

interface Row {
  key: string;
  file: string;
  state: 'uploading' | 'done' | 'error';
  results?: IngestResult[];
  error?: string;
}

function kindOf(file: File): 'pdf' | 'eml' | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'message/rfc822' || name.endsWith('.eml')) return 'eml';
  return null;
}

export default function UploadPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sender, setSender] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setRows((rs) => [{ key, file: file.name, state: 'uploading' }, ...rs]);
      const kind = kindOf(file);
      try {
        if (!kind) throw new Error('Only .pdf and .eml files are accepted.');
        if (file.size > (kind === 'pdf' ? MAX_PDF : MAX_EML)) throw new Error(`File exceeds the ${kind === 'pdf' ? 20 : 40} MiB limit.`);
        const results = kind === 'pdf' ? [await ingestApi.pdf(file, file.name, sender.trim() || undefined)] : (await ingestApi.eml(file)).items;
        patch(key, { state: 'done', results });
      } catch (e) {
        patch(key, { state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    client.invalidateQueries({ queryKey: ['cases'] });
    client.invalidateQueries({ queryKey: ['stats'] });
  }

  return (
    <>
      <PageHeader title="Upload invoices" subtitle="Submit PDF invoices or whole .eml emails. Each PDF becomes its own case." />
      <Card>
        <label className="field" style={{ maxWidth: 420, marginBottom: 16 }}>
          Sender (optional, PDF uploads only; provenance only, not used for vendor approval)
          <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="billing@vendor.example" maxLength={320} />
        </label>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
        >
          <strong>Drop files here or click to choose</strong>
          <div className="small muted">PDF up to 20 MiB · EML up to 40 MiB with up to 20 PDF attachments</div>
          <input
            ref={input}
            type="file"
            accept=".pdf,.eml,application/pdf,message/rfc822"
            multiple
            hidden
            onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }}
          />
        </div>
      </Card>
      {rows.length > 0 && (
        <Card title="Submissions">
          <DataTable
            rows={rows}
            rowKey={(r) => r.key}
            columns={[
              { key: 'file', header: 'File', render: (r) => <span className="wrap">{r.file}</span> },
              {
                key: 'result',
                header: 'Result',
                render: (r) =>
                  r.state === 'uploading' ? <span className="muted">Uploading…</span>
                  : r.state === 'error' ? <span style={{ color: 'var(--danger)' }}>{r.error}</span>
                  : (
                    <div className="stack" style={{ gap: 4 }}>
                      {r.results!.map((res) => (
                        <span key={res.id} className="row">
                          <Link to={`/cases/${res.id}`} className="mono">{shortId(res.id)}</Link>
                          <StatusBadge status={res.status} />
                          {res.duplicate_submission && <span className="small muted">existing case reused</span>}
                        </span>
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        </Card>
      )}
      <Alert tone="neutral">Identical files map to the same case, so uploading twice never double-reserves PO value.</Alert>
    </>
  );
}
