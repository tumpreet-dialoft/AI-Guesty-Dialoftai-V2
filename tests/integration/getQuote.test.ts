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

const MOCK_QUOTE = {
  _id: 'q_abc123',
  checkInDateLocalized: '2099-07-04',
  checkOutDateLocalized: '2099-07-06',
  rates: {
    ratePlans: [
      {
        ratePlan: {
          money: {
            fareAccommodation: 380,
            fareCleaning: 75,
            totalTaxes: 61,
            hostPayout: 516,
          },
          days: [
            { date: '2099-07-04', price: 190 },
            { date: '2099-07-05', price: 190 },
          ],
        },
      },
    ],
  },
};

describe('POST /get_quote', () => {
  beforeEach(() => {
    _resetForTest();
    mockFetch.mockReset();
  });

  it('happy path returns the seven fields (root-level args)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/token')) return tokenResp();
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(MOCK_QUOTE),
      };
    });

    const res = await request(app)
      .post('/get_quote')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      quote_id: 'q_abc123',
      suite: 'Garden Suite',
      nightly: 190,
      nights: 2,
      cleaning: 75,
      taxes: 61,
      total: 516,
    });
  });

  it('unknown suite name returns error: true', async () => {
    const res = await request(app)
      .post('/get_quote')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Nonexistent Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBe(true);
  });

  it('Guesty 500 returns error: true', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/token')) return tokenResp();
      return { ok: false, status: 500 };
    });

    const res = await request(app)
      .post('/get_quote')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBe(true);
  });
});
