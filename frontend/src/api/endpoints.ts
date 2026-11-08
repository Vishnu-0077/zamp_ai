/**
 * One function per backend route. Screens never call fetch directly, so a
 * backend change is absorbed here (and in types.ts) rather than in every page.
 */
import { buildUrl, request } from './client';
import type {
  AuditPage,
  CaseDetail,
  CasePage,
  CaseStatus,
  EmailPreview,
  Health,
  InboxEmail,
  IngestResult,
  InvoiceExtractionInput,
  References,
  Stats,
} from './types';

const V1 = '/api/v1';
const enc = encodeURIComponent;

export const systemApi = {
  reset: () => request<{ status: string }>(`${V1}/reset`, { method: 'POST' }),
  health: () => request<Health>('/health'),
  stats: () => request<Stats>(`${V1}/stats`),
  references: () => request<References>(`${V1}/references`),
  extractionSchema: () => request<Record<string, unknown>>(`${V1}/schema/extraction`),
};

export const casesApi = {
  list: (params: { status?: CaseStatus; limit?: number; offset?: number }) =>
    request<CasePage>(`${V1}/cases`, { query: params }),
  get: (id: string) => request<CaseDetail>(`${V1}/cases/${enc(id)}`),
  documentUrl: (id: string) => buildUrl(`${V1}/cases/${enc(id)}/document`),
  audit: (id: string, after = 0, limit = 100) =>
    request<AuditPage>(`${V1}/cases/${enc(id)}/audit`, { query: { after, limit } }),
  correct: (id: string, body: { expected_version: number; note: string; extraction: InvoiceExtractionInput }) =>
    request<CaseDetail>(`${V1}/cases/${enc(id)}/corrections`, { method: 'POST', json: body, reviewer: true }),
  retry: (id: string, body: { expected_version: number; note: string }) =>
    request<CaseDetail>(`${V1}/cases/${enc(id)}/retry`, { method: 'POST', json: body, reviewer: true }),
};

export const ingestApi = {
  email: (emailId: number) =>
    request<IngestResult>(`${V1}/ingest/email`, { method: 'POST', json: { email_id: emailId } }),
  pdf: (file: Blob, filename: string, sender?: string) =>
    request<IngestResult>(`${V1}/ingest/pdf`, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'application/pdf',
        'X-Filename': filename,
        ...(sender ? { 'X-Sender': sender } : {}),
      },
    }),
  eml: (file: Blob) =>
    request<{ items: IngestResult[] }>(`${V1}/ingest/eml`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'message/rfc822' },
    }),
};

export const inboxApi = {
  list: () => request<InboxEmail[]>('/emails'),
  preview: (id: number) => request<EmailPreview>(`/emails/${id}/preview`),
  attachmentUrl: (id: number) => buildUrl(`/emails/${id}/attachment`),
  rawUrl: (id: number) => buildUrl(`/emails/${id}/raw`),
};
