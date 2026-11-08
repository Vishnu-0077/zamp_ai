/**
 * The reviewer's name, remembered in this browser so it is typed once.
 * No credential: anyone on the dashboard may review; the name is recorded
 * with each correction, approval and retry in the audit trail and Excel export.
 */
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'invoice-review.reviewer-name';
const listeners = new Set<() => void>();
let memory = '';

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function getReviewerName(): string {
  return read();
}

export function setReviewerName(value: string): void {
  memory = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: memory fallback for this page */
  }
  listeners.forEach((l) => l());
}

export function useReviewerName(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => '',
  );
}

/** A usable name: at least two non-space characters. */
export function isValidName(name: string): boolean {
  return name.trim().length >= 2;
}
