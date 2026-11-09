export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** One whole split into parts, with a legend carrying the counts so colour is never the only cue. */
export function SegmentedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '0%');
  return (
    <div>
      <div className="segbar" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
        {segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.key} title={`${s.label}: ${s.value} (${pct(s.value)})`} style={{ flexGrow: s.value, background: s.color }} />
        ))}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.key}>
            <span className="key" style={{ background: s.color }} aria-hidden="true" />
            {s.label} <strong>{s.value}</strong> <span className="muted">({pct(s.value)})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
