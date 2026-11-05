import { useState } from 'react';
import type { AuditEvent, CaseStatus } from '@/api/types';
import { Badge, Empty, ErrorMessage, JsonView, Loading } from '@/components';
import { formatDateTime, humanize } from '@/lib/format';
import { useAudit } from '../hooks';

function summary(e: AuditEvent): string | null {
  const p = e.payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.note === 'string') return `Note: ${p.note}`;
  if ('passed' in p) return p.passed ? 'Passed' : `${(p.findings as unknown[])?.length ?? 0} finding(s)`;
  if (p.decision && typeof p.decision === 'object') return String((p.decision as { outcome?: string }).outcome ?? '');
  if (typeof p.explanation === 'string') return p.explanation;
  if (typeof p.filename === 'string') return `${p.filename}${p.sender ? ` from ${p.sender}` : ''}`;
  return null;
}

export function AuditTimeline({ caseId, status }: { caseId: string; status: CaseStatus }) {
  const { data, error, isLoading } = useAudit(caseId, status);
  const [open, setOpen] = useState<number | null>(null);
  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} title="Could not load audit trail" />;
  if (!data?.length) return <Empty>No audit events.</Empty>;
  return (
    <ol className="timeline">
      {data.map((e) => {
        const passed = (e.payload as { passed?: boolean } | null)?.passed;
        return (
          <li key={e.id}>
            <div className="row">
              <strong>{humanize(e.event)}</strong>
              {passed !== undefined && <Badge tone={passed ? 'ok' : 'warn'}>{passed ? 'passed' : 'findings'}</Badge>}
              <span className="small muted">{formatDateTime(e.at)} · {e.actor}</span>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                {open === e.id ? 'Hide' : 'Details'}
              </button>
            </div>
            {summary(e) && <div className="small muted wrap">{summary(e)}</div>}
            {open === e.id && <JsonView value={e.payload} />}
          </li>
        );
      })}
    </ol>
  );
}
