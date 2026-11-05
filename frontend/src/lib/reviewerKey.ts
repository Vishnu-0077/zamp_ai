/**
 * Reviewer credential, entered at runtime and kept in sessionStorage only
 * (cleared when the tab closes). It is never bundled or sent to the proxy env.
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'invoice-review.reviewer-key';
const listeners = new Set<() => void>();
let memory = '';

function read(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function getReviewerKey(): string {
  return read();
}

export function setReviewerKey(value: string): void {
  memory = value;
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: memory fallback */
  }
  listeners.forEach((l) => l());
}

export function useReviewerKey(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => '',
  );
}
