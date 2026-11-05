import { useStats } from './hooks';

export function ReviewCountBadge() {
  const { data } = useStats();
  const n = data?.counts.review ?? 0;
  return n > 0 ? <span className="count" aria-label={`${n} cases need review`}>{n}</span> : null;
}
