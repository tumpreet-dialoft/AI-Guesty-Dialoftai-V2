import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  config: { LOG_LEVEL: 'silent', NODE_ENV: 'test' },
}));
vi.mock('../../src/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { shapeAvailability, buildAvailabilityResponse } from '../../src/shapers/availability';
import { shapeQuote } from '../../src/shapers/quote';

describe('shapeAvailability', () => {
  it('returns shaped suite when available', () => {
    const raw = { available: true, rates: { basePrice: 379.5 } };
    const result = shapeAvailability('Garden Suite', raw);
    expect(result).toEqual({ name: 'Garden Suite', nightly: 380 });
  });

  it('returns null when not available', () => {
    const raw = { available: false };
    const result = shapeAvailability('Garden Suite', raw);
    expect(result).toBeNull();
  });

  it('returns null when nightly rate is missing', () => {
    const raw = { available: true };
    const result = shapeAvailability('Garden Suite', raw);
    expect(result).toBeNull();
  });

  it('filters out unavailable listings in buildAvailabilityResponse', () => {
    const suites = [{ name: 'Garden Suite', nightly: 380 }];
    const result = buildAvailabilityResponse(suites);
    expect(result.available).toBe(true);
    expect(result.suites).toHaveLength(1);
  });

  it('returns available: false when suites array is empty', () => {
    const result = buildAvailabilityResponse([]);
    expect(result.available).toBe(false);
    expect(result.suites).toHaveLength(0);
  });
});

describe('shapeQuote', () => {
  it('returns exactly seven fields, rounded to whole dollars', () => {
    const raw = {
      _id: 'q_8sd9f7',
      rates: {
        basePrice: 379.5,
        cleaningFee: 74.99,
        taxes: 61.23,
        total: 895.72,
      },
      nights: 2,
    };
    const result = shapeQuote('Garden Suite', raw);
    expect(result).toEqual({
      quote_id: 'q_8sd9f7',
      suite: 'Garden Suite',
      nightly: 380,
      nights: 2,
      cleaning: 75,
      taxes: 61,
      total: 896,
    });
  });

  it('returns null when a required field is missing', () => {
    const raw = { _id: 'q_abc', rates: { basePrice: 300 } };
    const result = shapeQuote('Garden Suite', raw);
    expect(result).toBeNull();
  });

  it('returns null when input is null', () => {
    const result = shapeQuote('Garden Suite', null);
    expect(result).toBeNull();
  });

  it('returns null when input is undefined', () => {
    const result = shapeQuote('Garden Suite', undefined);
    expect(result).toBeNull();
  });
});
