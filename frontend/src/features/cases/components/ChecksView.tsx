import { Badge, Empty, JsonView } from '@/components';
import { humanize } from '@/lib/format';

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === 'boolean') return <Badge tone={value ? 'ok' : 'danger'}>{String(value)}</Badge>;
  if (typeof value !== 'object') return <span className="wrap">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <span className="wrap">{value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')}</span> : <span className="muted">none</span>;
  return (
    <div className="row">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <span key={k} className="small">
          <span className="muted">{humanize(k)}:</span> <Cell value={v} />
        </span>
      ))}
    </div>
  );
}

/** Generic renderer for the backend's free-form `checks` dictionary. */
export function ChecksView({ checks }: { checks: Record<string, unknown> }) {
  const entries = Object.entries(checks ?? {});
  if (!entries.length) return <Empty>No checks recorded yet.</Empty>;
  return (
    <div className="stack">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Check</th><th>Result</th></tr></thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td style={{ whiteSpace: 'nowrap' }}><code>{k}</code></td>
                <td><Cell value={v} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="small muted">Raw JSON</summary>
        <JsonView value={checks} />
      </details>
    </div>
  );
}
