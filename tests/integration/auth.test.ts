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

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Retell auth middleware', () => {
  beforeEach(() => {
    _resetForTest();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok_test', expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ available: false }),
      };
    });
  });

  it('rejects requests without x-retell-secret header', async () => {
    const res = await request(app)
      .post('/check_availability')
      .send({ args: { check_in_date: '2099-01-01', check_out_date: '2099-01-03', number_of_guests: 2 } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('rejects requests with wrong secret', async () => {
    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', 'wrong-secret')
      .send({ args: { check_in_date: '2099-01-01', check_out_date: '2099-01-03', number_of_guests: 2 } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('accepts requests with correct secret', async () => {
    const res = await request(app)
      .post('/check_availability')
      .set('x-retell-secret', 'test-secret-123')
      .send({ args: { check_in_date: '2099-01-01', check_out_date: '2099-01-03', number_of_guests: 2 } });
    expect(res.status).not.toBe(401);
  });

  it('/health works without secret', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
