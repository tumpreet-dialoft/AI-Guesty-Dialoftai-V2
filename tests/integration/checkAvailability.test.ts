import './setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { _resetForTest } from '../../src/guesty/tokenCache';
import { _resetListingPriceCacheForTest } from '../../src/guesty/bookingEngine';

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

const LISTINGS_RESP = {
  results: [
    { _id: 'lst_psv_001', prices: { basePrice: 255 } },
    { _id: 'lst_premium_002', prices: { basePrice: 245 } },
    { _id: 'lst_main_003', prices: { basePrice: 255 } },
    { _id: 'lst_garden_004', prices: { basePrice: 235 } },
    { _id: 'lst_ada_005', prices: { basePrice: 240 } },
  ],
};

function calendarResp(available: boolean) {
  const days = [
    { date: '2099-07-04', status: available ? 'available' : 'booked' },
    { date: '2099-07-05', status: available ? 'available' : 'booked' },
  ];
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(days),
  };
}

function listingsResp() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(LISTINGS_RESP),
  };
}

describe('POST /check_availability', () => {
  beforeEach(() => {
    _resetForTest();
    _resetListingPriceCacheForTest();
    mockFetch.mockReset();
  });

  it('happy path — args nested under args key', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2/token')) return tokenResp();
      if (u.includes('/listings?')) return listingsResp();
      return calendarResp(true);
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
      if (u.includes('/listings?')) return listingsResp();
      return calendarResp(true);
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
      if (u.includes('/listings?')) return listingsResp();
      return calendarResp(false);
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
