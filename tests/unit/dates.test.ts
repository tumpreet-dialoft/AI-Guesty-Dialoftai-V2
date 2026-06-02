import { describe, it, expect } from 'vitest';
import { isValidIsoDate, isNotInPast, isCheckoutAfterCheckin, validateDateRange } from '../../src/util/dates';

describe('isValidIsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isValidIsoDate('2026-07-04')).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(isValidIsoDate('07/04/2026')).toBe(false);
    expect(isValidIsoDate('2026-7-4')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
  });

  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
  });
});

describe('isNotInPast', () => {
  it('accepts a future date', () => {
    expect(isNotInPast('2099-01-01')).toBe(true);
  });

  it('rejects a past date', () => {
    expect(isNotInPast('2020-01-01')).toBe(false);
  });
});

describe('isCheckoutAfterCheckin', () => {
  it('accepts checkout after checkin', () => {
    expect(isCheckoutAfterCheckin('2026-07-04', '2026-07-06')).toBe(true);
  });

  it('rejects checkout equal to checkin', () => {
    expect(isCheckoutAfterCheckin('2026-07-04', '2026-07-04')).toBe(false);
  });

  it('rejects checkout before checkin', () => {
    expect(isCheckoutAfterCheckin('2026-07-06', '2026-07-04')).toBe(false);
  });
});

describe('validateDateRange', () => {
  it('accepts valid future range', () => {
    expect(validateDateRange('2099-01-01', '2099-01-03')).toEqual({ ok: true });
  });

  it('rejects past check-in', () => {
    const result = validateDateRange('2020-01-01', '2020-01-03');
    expect(result.ok).toBe(false);
  });

  it('rejects checkout <= checkin', () => {
    const result = validateDateRange('2099-01-05', '2099-01-03');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = validateDateRange('bad', '2099-01-03');
    expect(result.ok).toBe(false);
  });
});
