import type { ReactNode } from 'react';
import type { CaseStatus, Confidence } from '@/api/types';
import { CONFIDENCE_TONE, STATUS_META, type Tone } from '@/lib/tones';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone, description: '' };
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return <Badge tone={CONFIDENCE_TONE[value] ?? 'neutral'}>{value}</Badge>;
}
