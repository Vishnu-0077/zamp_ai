/**
 * Friendly aliases over the generated OpenAPI types (schema.d.ts).
 * Regenerate schema.d.ts with `npm run gen:api` after backend contract changes;
 * TypeScript will then flag every screen affected by the change.
 */
import type { components } from './schema';

type S = components['schemas'];

export type CaseSummary = S['CaseSummary'];
export type CaseDetail = S['CaseDetail'];
export type CasePage = S['CasePage'];
export type CaseStatus = CaseSummary['status'];
export type Finding = S['Finding'];
export type Decision = S['Decision'];
export type IngestResult = S['IngestResult'];
export type InvoiceExtraction = S['InvoiceExtraction-Output'];
export type InvoiceExtractionInput = S['InvoiceExtraction-Input'];
export type ExtractionBatch = S['ExtractionBatch'];
export type LineItem = S['LineItem-Output'];
export type TaxComponent = S['TaxComponent-Output'];
export type Confidence = S['ExtractedField_str_']['confidence'];
export type ExtractedField<T = string> = {
  value: T | null;
  confidence: Confidence;
  evidence: string | null;
  page: number | null;
};

export const CASE_STATUSES: CaseStatus[] = ['queued', 'processing', 'review', 'approved', 'duplicate'];
export const IN_FLIGHT: CaseStatus[] = ['queued', 'processing'];

/** Finding codes that the backend accepts for POST /cases/{id}/retry. */
export const RETRYABLE_CODES = [
  'OCR_UNAVAILABLE',
  'OCR_FAILED',
  'EXTRACTION_NOT_CONFIGURED',
  'EXTRACTION_SCHEMA_FAILED',
  'PROCESSING_ERROR',
] as const;

// Endpoints below are untyped in the OpenAPI document; shapes follow the backend code.
export interface Stats {
  counts: Partial<Record<CaseStatus, number>>;
}
export interface Health {
  status: string;
  worker_enabled: boolean;
  worker_alive: boolean;
  extraction_configured: boolean;
}
export interface AuditEvent {
  id: number;
  job_id: string;
  at: string;
  actor: string;
  event: string;
  payload: unknown;
}
export interface AuditPage {
  items: AuditEvent[];
}
export interface PageText {
  page: number;
  text: string;
  route: 'digital' | 'ocr' | string;
  ocr_confidence: number | null;
}
export interface Vendor {
  id: string;
  name: string;
  domain?: string;
  approved?: boolean;
  payment_terms?: string;
  currency?: string;
  bank_account?: string;
  [key: string]: unknown;
}
export interface PurchaseOrder {
  number: string;
  vendor_id: string;
  amount: number | string;
  received_amount?: number | string;
  previously_invoiced?: number | string;
  tolerance_percent?: number;
  currency: string;
  issue_date?: string;
  [key: string]: unknown;
}
export interface FxRate {
  from_currency: string;
  to_currency: string;
  date: string;
  rate: string;
  approved: boolean;
  source?: string;
}
export interface References {
  vendors: Vendor[];
  purchase_orders: PurchaseOrder[];
  fx_rates?: FxRate[];
  policy: Record<string, unknown>;
  [key: string]: unknown;
}
export interface InboxEmail {
  id: number;
  sender: string;
  subject: string;
  [key: string]: unknown;
}
export interface EmailPreview {
  id: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}
