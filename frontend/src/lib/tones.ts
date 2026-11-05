/** Maps domain values to visual tones. Add new statuses here once. */
import type { CaseStatus, Confidence } from '@/api/types';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export const STATUS_META: Record<CaseStatus, { label: string; tone: Tone; description: string }> = {
  queued: { label: 'Queued', tone: 'neutral', description: 'Waiting for the worker' },
  processing: { label: 'Processing', tone: 'info', description: 'OCR / extraction in progress' },
  review: { label: 'Needs review', tone: 'warn', description: 'Held for a human reviewer' },
  approved: { label: 'Approved', tone: 'ok', description: 'All rules passed; PO value reserved' },
  duplicate: { label: 'Duplicate', tone: 'danger', description: 'Matches an existing invoice' },
};

export const CONFIDENCE_TONE: Record<Confidence, Tone> = { high: 'ok', medium: 'warn', low: 'danger' };
