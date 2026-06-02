import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
  config: {
    GUESTY_BE_BASE_URL: 'https://booking.guesty.com/api',
    GUESTY_BE_CLIENT_ID: 'test_be_id',
    GUESTY_BE_CLIENT_SECRET: 'test_be_secret',
    GUESTY_OAPI_BASE_URL: 'https://open-api.guesty.com/v1',
    GUESTY_OAPI_CLIENT_ID: 'test_oapi_id',
    GUESTY_OAPI_CLIENT_SECRET: 'test_oapi_secret',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../src/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/util/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/util/jitter', () => ({
  jitter: () => 0,
}));

import { _resetForTest } from '../../src/guesty/tokenCache';
import { guestyFetch } from '../../src/guesty/client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function tokenResp(token: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: token, expires_in: 3600 }),
  };
}

function jsonResp(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    text: async () => JSON.stringify(body),
  };
}

describe('guestyFetch backoff', () => {
  beforeEach(() => {
    _resetForTest();
    mockFetch.mockReset();
  });

  it('honors Retry-After on 429, retries, eventually succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResp('tok_test'))
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k === 'Retry-After' ? '1' : null) },
      })
      .mockResolvedValueOnce(jsonResp(200, { result: 'ok' }));

    const result = await guestyFetch('booking_engine', 'GET', '/test-path');
    expect(result).toEqual({ result: 'ok' });
  });

  it('refreshes token on 401 and retries once', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResp('tok_old'))
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce(tokenResp('tok_new'))
      .mockResolvedValueOnce(jsonResp(200, { result: 'refreshed' }));

    const result = await guestyFetch('booking_engine', 'GET', '/test-path');
    expect(result).toEqual({ result: 'refreshed' });
  });

  it('gives up after 3 retries with GuestyError("rate_limited")', async () => {
    const r429 = {
      ok: false,
      status: 429,
      headers: { get: (k: string) => (k === 'Retry-After' ? '1' : null) },
    };

    mockFetch
      .mockResolvedValueOnce(tokenResp('tok_test'))
      .mockResolvedValueOnce(r429)
      .mockResolvedValueOnce(r429)
      .mockResolvedValueOnce(r429)
      .mockResolvedValueOnce(r429);

    await expect(guestyFetch('booking_engine', 'GET', '/test-path')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('retries on 5xx with exponential backoff', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResp('tok_test'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(jsonResp(200, { result: 'recovered' }));

    const result = await guestyFetch('booking_engine', 'GET', '/test-path');
    expect(result).toEqual({ result: 'recovered' });
  });

  it('gives up after max 5xx retries', async () => {
    const r500 = { ok: false, status: 500 };

    mockFetch
      .mockResolvedValueOnce(tokenResp('tok_test'))
      .mockResolvedValueOnce(r500)
      .mockResolvedValueOnce(r500)
      .mockResolvedValueOnce(r500)
      .mockResolvedValueOnce(r500);

    await expect(guestyFetch('booking_engine', 'GET', '/test-path')).rejects.toMatchObject({
      code: 'upstream_error',
    });
  });
});
