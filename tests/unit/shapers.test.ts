import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  config: { LOG_LEVEL: 'silent', NODE_ENV: 'test' },
}));
vi.mock('../../src/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { shapeAvailabilityFromListing, buildAvailabilityResponse } from '../../src/shapers/availability';
import { shapeQuote } from '../../src/shapers/quote';

describe('shapeAvailabilityFromListing', () => {
  it('returns shaped suite when all dates have allotment > 0', () => {
    const listing = {
      nightlyRates: { '2026-07-10': 220, '2026-07-11': 180 },
      allotment: { '2026-07-10': 1, '2026-07-11': 2 },
      prices: { basePrice: 255 },
    };
    const result = shapeAvailabilityFromListing('Premium Suite', listing);
    expect(result).toEqual({ name: 'Premium Suite', nightly: 200 });
  });

  it('returns null when a date has allotment 0', () => {
    const listing = {
      nightlyRates: { '2026-07-10': 220, '2026-07-11': 180 },
      allotment: { '2026-07-10': 1, '2026-07-11': 0 },
      prices: { basePrice: 255 },
    };
    const result = shapeAvailabilityFromListing('Premium Suite', listing);
    expect(result).toBeNull();
  });

  it('returns null when allotment is empty', () => {
    const listing = {
      nightlyRates: { '2026-07-10': 220 },
      allotment: {},
      prices: { basePrice: 235 },
    };
    const result = shapeAvailabilityFromListing('Garden Suite', listing);
    expect(result).toBeNull();
  });

  it('returns null when allotment is missing', () => {
    const listing = {
      nightlyRates: { '2026-07-10': 220 },
      prices: { basePrice: 235 },
    };
    const result = shapeAvailabilityFromListing('Garden Suite', listing);
    expect(result).toBeNull();
  });

  it('falls back to basePrice when nightlyRates is empty', () => {
    const listing = {
      nightlyRates: {},
      allotment: { '2026-07-10': 1 },
      prices: { basePrice: 235 },
    };
    const result = shapeAvailabilityFromListing('Garden Suite', listing);
    expect(result).toEqual({ name: 'Garden Suite', nightly: 235 });
  });

  it('returns null when nightly rate is 0', () => {
    const listing = {
      nightlyRates: {},
      allotment: { '2026-07-10': 1 },
      prices: { basePrice: 0 },
    };
    const result = shapeAvailabilityFromListing('Garden Suite', listing);
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
        ratePlans: [
          {
            ratePlan: {
              money: {
                fareAccommodation: 359.49,
                fareCleaning: 0,
                totalTaxes: 53.92,
                hostPayout: 413.41,
              },
              days: [
                { date: '2026-07-10', price: 176.44 },
                { date: '2026-07-11', price: 183.05 },
              ],
            },
          },
        ],
      },
    };
    const result = shapeQuote('Premium Suite', raw);
    expect(result).toEqual({
      quote_id: 'q_8sd9f7',
      suite: 'Premium Suite',
      nightly: 180,
      nights: 2,
      cleaning: 0,
      taxes: 54,
      total: 413,
    });
  });

  it('returns null when money block is missing', () => {
    const raw = { _id: 'q_abc', rates: { ratePlans: [] } };
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
