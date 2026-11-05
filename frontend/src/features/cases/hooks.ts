import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { casesApi, systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { IN_FLIGHT, type AuditEvent, type CaseDetail, type CaseStatus } from '@/api/types';

const POLL_MS = 2500;

export function useStats() {
  return useQuery({ queryKey: qk.stats, queryFn: systemApi.stats, refetchInterval: 10_000 });
}

export function useCases(params: { status?: CaseStatus; limit: number; offset: number }) {
  return useQuery({
    queryKey: qk.cases.list(params),
    queryFn: () => casesApi.list(params),
    placeholderData: (prev) => prev,
    // Keep the list live while anything on screen is still being processed.
    refetchInterval: (q) => (q.state.data?.items.some((c) => IN_FLIGHT.includes(c.status)) ? POLL_MS : 15_000),
  });
}

export function useCase(id: string) {
  return useQuery({
    queryKey: qk.cases.detail(id),
    queryFn: () => casesApi.get(id),
    refetchInterval: (q) => (q.state.data && IN_FLIGHT.includes(q.state.data.status) ? POLL_MS : false),
  });
}

export function useAudit(id: string, status?: CaseStatus) {
  return useQuery({
    queryKey: [...qk.cases.audit(id), status],
    queryFn: async () => {
      const all: AuditEvent[] = [];
      let after = 0;
      for (let i = 0; i < 20; i++) {
        const page = await casesApi.audit(id, after, 500);
        all.push(...page.items);
        if (page.items.length < 500) break;
        after = page.items[page.items.length - 1].id;
      }
      return all;
    },
  });
}

function useCaseMutation<V>(id: string, fn: (vars: V) => Promise<CaseDetail>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      client.setQueryData(qk.cases.detail(id), data);
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: qk.cases.all });
      client.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useCorrectCase(id: string) {
  return useCaseMutation(id, (body: Parameters<typeof casesApi.correct>[1]) => casesApi.correct(id, body));
}

export function useRetryCase(id: string) {
  return useCaseMutation(id, (body: Parameters<typeof casesApi.retry>[1]) => casesApi.retry(id, body));
}
