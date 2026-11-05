import { describe, expect, it } from 'vitest';
import { formatAmount, humanize } from './format';

describe('formatAmount', () => {
  it('groups digits without float conversion', () => {
    expect(formatAmount('1234567.5', 'USD')).toBe('USD 1,234,567.50');
    expect(formatAmount('0.10')).toBe('0.10');
    expect(formatAmount('-1000')).toBe('-1,000.00');
    // Beyond float precision: must stay exact.
    expect(formatAmount('12345678901234567.89')).toBe('12,345,678,901,234,567.89');
  });
  it('handles empty and non-numeric values', () => {
    expect(formatAmount(null)).toBe('—');
    expect(formatAmount('abc', 'EUR')).toBe('EUR abc');
  });
});

describe('humanize', () => {
  it('turns keys into labels', () => expect(humanize('po_matching')).toBe('Po matching'));
});
