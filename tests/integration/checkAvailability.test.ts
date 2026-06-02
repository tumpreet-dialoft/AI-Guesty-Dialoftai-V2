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

function availResp(available: boolean, basePrice?: number) {
  const body = available ? { available: true, rates: { basePrice } } : { available: false };
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

describe('POST /check_availability', () => {
  beforeEach(() => {
    _resetForTest();
    mockFetch.mockReset();
  });

  it('happy path returns shaped JSON with available suites', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/token')) return tokenResp();
      if (String(url).includes('lst_garden_123')) return availResp(true, 380);
      if (String(url).includes('lst_premium_456')) return availResp(true, 295);
      return availResp(false);
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
    expect(res.body.suites[0]).toHaveProperty('name');
    expect(res.body.suites[0]).toHaveProperty('nightly');
  });

  it('date in past returns error: true', async () => {
    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', SECRET)
      .send({
        args: {
          check_in_date: '2020-01-01',
          check_out_date: '2020-01-03',
          number_of_guests: 2,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBe(true);
  });

  it('Guesty 429 then success returns shaped JSON', async () => {
    let requestCount = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/token')) return tokenResp();
      requestCount++;
      if (requestCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (k: string) => (k === 'Retry-After' ? '1' : null) },
        };
      }
      return availResp(true, 300);
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
  });

  it('all unavailable returns available: false, suites: []', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/token')) return tokenResp();
      return availResp(false);
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
    expect(res.body.available).toBe(false);
    expect(res.body.suites).toEqual([]);
  });
});
