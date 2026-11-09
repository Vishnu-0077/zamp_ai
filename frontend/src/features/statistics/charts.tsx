import type { ReactNode } from 'react';

export interface BarDatum {
  key: string;
  label: ReactNode;
  value: number;
  /** Text at the bar tip, e.g. "3 (60%)". Defaults to the value. */
  display?: string;
  /** Hover text with the full detail. */
  title?: string;
}

/** Ranked horizontal bars, one series (so no legend: the card title names it). */
export function HBars({ data, label }: { data: BarDatum[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbars" role="list" aria-label={label}>
      {data.map((d) => (
        <div className="hbar-row" role="listitem" key={d.key} title={d.title}>
          <div className="hbar-label">{d.label}</div>
          <div className="hbar-track">
            <div className="hbar" style={{ width: `${(d.value / max) * 85}%` }} />
            <span className="hbar-value">{d.display ?? d.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

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
