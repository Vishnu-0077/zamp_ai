/** Central React Query keys, so invalidation stays consistent across features. */
import type { CaseStatus } from './types';

export const qk = {
  health: ['health'] as const,
  stats: ['stats'] as const,
  references: ['references'] as const,
  cases: {
    all: ['cases'] as const,
    list: (p: { status?: CaseStatus; limit: number; offset: number }) => ['cases', 'list', p] as const,
    detail: (id: string) => ['cases', 'detail', id] as const,
    audit: (id: string) => ['cases', 'audit', id] as const,
  },
  inbox: {
    list: ['inbox'] as const,
    preview: (id: number) => ['inbox', 'preview', id] as const,
  },
};
