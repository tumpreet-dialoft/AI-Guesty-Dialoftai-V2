import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
  config: {
    GUESTY_BE_BASE_URL: 'https://booking.guesty.com/api',
    GUESTY_BE_TOKEN_URL: 'https://booking.guesty.com/oauth2/token',
    GUESTY_BE_CLIENT_ID: 'test_be_id',
    GUESTY_BE_CLIENT_SECRET: 'test_be_secret',
    GUESTY_OAPI_BASE_URL: 'https://open-api.guesty.com/v1',
    GUESTY_OAPI_TOKEN_URL: 'https://open-api.guesty.com/oauth2/token',
    GUESTY_OAPI_CLIENT_ID: 'test_oapi_id',
    GUESTY_OAPI_CLIENT_SECRET: 'test_oapi_secret',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../src/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { getToken, invalidateToken, _resetForTest } from '../../src/guesty/tokenCache';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockTokenResponse(token: string, expiresIn: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: token, expires_in: expiresIn }),
  };
}

describe('tokenCache', () => {
  beforeEach(() => {
    _resetForTest();
    mockFetch.mockReset();
  });

  it('returns a token from the OAuth endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_abc', 3600));
    const token = await getToken('booking_engine');
    expect(token).toBe('tok_abc');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns cached token on second call without a second fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_cached', 3600));

    const t1 = await getToken('booking_engine');
    const t2 = await getToken('booking_engine');
    expect(t1).toBe('tok_cached');
    expect(t2).toBe('tok_cached');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('refreshes when within 5-min buffer of expiry', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_soon_expired', 200));
    await getToken('booking_engine');

    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_new', 3600));
    const t2 = await getToken('booking_engine');
    expect(t2).toBe('tok_new');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('concurrent requests share a single in-flight fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_shared', 3600));

    const [t1, t2, t3] = await Promise.all([
      getToken('booking_engine'),
      getToken('booking_engine'),
      getToken('booking_engine'),
    ]);

    expect(t1).toBe('tok_shared');
    expect(t2).toBe('tok_shared');
    expect(t3).toBe('tok_shared');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws token_fetch_failed on upstream 500', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(getToken('booking_engine')).rejects.toMatchObject({ code: 'token_fetch_failed' });
  });

  it('refetches after invalidation', async () => {
    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_first', 3600));
    await getToken('booking_engine');

    invalidateToken('booking_engine');

    mockFetch.mockResolvedValueOnce(mockTokenResponse('tok_second', 3600));
    const t2 = await getToken('booking_engine');
    expect(t2).toBe('tok_second');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
