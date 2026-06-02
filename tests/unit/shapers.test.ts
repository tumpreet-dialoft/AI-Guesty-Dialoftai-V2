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
  it('returns shaped suite when all days are available', () => {
    const raw = [
      { date: '2026-07-10', status: 'available' },
      { date: '2026-07-11', status: 'available' },
    ];
    const result = shapeAvailability('Premium Suite', raw, 255);
    expect(result).toEqual({ name: 'Premium Suite', nightly: 255 });
  });

  it('returns null when a day is not available', () => {
    const raw = [
      { date: '2026-07-10', status: 'available' },
      { date: '2026-07-11', status: 'booked' },
    ];
    const result = shapeAvailability('Premium Suite', raw, 255);
    expect(result).toBeNull();
  });

  it('returns null when response is empty array', () => {
    const result = shapeAvailability('Garden Suite', [], 235);
    expect(result).toBeNull();
  });

  it('returns null when response is not an array', () => {
    const result = shapeAvailability('Garden Suite', { available: true }, 235);
    expect(result).toBeNull();
  });

  it('returns null when basePrice is 0', () => {
    const raw = [{ date: '2026-07-10', status: 'available' }];
    const result = shapeAvailability('Garden Suite', raw, 0);
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
