import type { Finding } from '@/api/types';
import { Badge, Empty } from '@/components';
import { humanize } from '@/lib/format';

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <Empty>No findings. All configured rules passed.</Empty>;
  return (
    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`} className="alert tone-warn" style={{ margin: 0 }}>
          <div className="row">
            <code>{f.code}</code>
            <Badge tone="neutral">{humanize(f.stage)}</Badge>
            {f.field && <Badge tone="info">{f.field}</Badge>}
          </div>
          <div className="wrap" style={{ marginTop: 4, color: 'var(--text)' }}>{f.message}</div>
        </li>
      ))}
    </ul>
  );
}
