import './setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { _resetForTest } from '../../src/guesty/tokenCache';

vi.mock('../../src/util/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/util/jitter', () => ({
  jitter: () => 0,
}));

const SECRET = 'test-secret-123';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function tokenResp() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'tok_test', expires_in: 3600 }),
  };
}

function listingsWithAvailability(available: boolean) {
  const allotmentVal = available ? 1 : 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify({
        results: [
          {
            _id: 'lst_psv_001',
            prices: { basePrice: 255 },
            nightlyRates: { '2099-07-04': 220, '2099-07-05': 180 },
            allotment: { '2099-07-04': allotmentVal, '2099-07-05': allotmentVal },
          },
          {
            _id: 'lst_premium_002',
            prices: { basePrice: 245 },
            nightlyRates: { '2099-07-04': 210, '2099-07-05': 170 },
            allotment: { '2099-07-04': allotmentVal, '2099-07-05': allotmentVal },
          },
          {
            _id: 'lst_main_003',
            prices: { basePrice: 255 },
            nightlyRates: { '2099-07-04': 220, '2099-07-05': 180 },
            allotment: { '2099-07-04': allotmentVal, '2099-07-05': allotmentVal },
          },
          {
            _id: 'lst_garden_004',
            prices: { basePrice: 235 },
            nightlyRates: { '2099-07-04': 200, '2099-07-05': 160 },
            allotment: { '2099-07-04': allotmentVal, '2099-07-05': allotmentVal },
          },
          {
            _id: 'lst_ada_005',
            prices: { basePrice: 240 },
            nightlyRates: { '2099-07-04': 210, '2099-07-05': 170 },
            allotment: { '2099-07-04': allotmentVal, '2099-07-05': allotmentVal },
          },
        ],
      }),
  };
}

describe('POST /check_availability', () => {
  beforeEach(() => {
    _resetForTest();
    mockFetch.mockReset();
  });

  it('happy path — args nested under args key', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2/token')) return tokenResp();
      return listingsWithAvailability(true);
    });

    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', SECRET)
      .send({
        args: {
          check_in_date: '2099-07-04',
          check_out_date: '2099-07-06',
          number_of_guests: 2,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.suites.length).toBeGreaterThanOrEqual(1);
  });

  it('happy path — args at root (Retell args_at_root: true)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2/token')) return tokenResp();
      return listingsWithAvailability(true);
    });

    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', SECRET)
      .send({
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
      });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.suites.length).toBeGreaterThanOrEqual(1);
  });

  it('date in past returns error: true', async () => {
    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', SECRET)
      .send({
        check_in_date: '2020-01-01',
        check_out_date: '2020-01-03',
        number_of_guests: '2',
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBe(true);
  });

  it('all unavailable returns available: false, suites: []', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2/token')) return tokenResp();
      return listingsWithAvailability(false);
    });

    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', SECRET)
      .send({
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
      });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.suites).toEqual([]);
  });
});
