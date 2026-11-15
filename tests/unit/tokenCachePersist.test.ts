import { describe, it, expect, vi, beforeEach } from 'vitest';

// 15 Nov 2026: a day of Render deploys used up Guesty's 5 tokens / 24 h, because every deploy wiped
// the /tmp token cache. These cover the fix: keep a copy in the service env and honour ratelimit-reset.
const TOKEN_PATH = ['oauth2', 'token'].join('/');
vi.mock('../../src/config', () => ({
  config: {
    GUESTY_BE_TOKEN_URL: 'https://booking.guesty.com/' + ['oauth2', 'token'].join('/'),
    GUESTY_BE_CLIENT_ID: 'be',
    GUESTY_BE_CLIENT_SECRET: 'be_s',
    GUESTY_OAPI_TOKEN_URL: 'https://open-api.guesty.com/' + ['oauth2', 'token'].join('/'),
    GUESTY_OAPI_CLIENT_ID: 'oa',
    GUESTY_OAPI_CLIENT_SECRET: 'oa_s',
    RENDER_API_KEY: 'rnd_test',
  },
}));
vi.mock('../../src/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('fs', () => ({
  default: { existsSync: () => false, readFileSync: () => '', writeFileSync: () => undefined },
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: () => undefined,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const minted = (tok: string) => async (url: string) =>
  String(url).includes(TOKEN_PATH)
    ? { ok: true, status: 200, json: async () => ({ access_token: tok, expires_in: 86400 }) }
    : { ok: true, status: 200 };

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  delete process.env.GUESTY_TOKEN_CACHE;
  process.env.RENDER_SERVICE_ID = 'srv-test';
});

describe('Guesty token survives a redeploy', () => {
  it('a fresh container uses the token kept in GUESTY_TOKEN_CACHE and mints none', async () => {
    process.env.GUESTY_TOKEN_CACHE = JSON.stringify({
      open_api: { accessToken: 'tok_saved', expiresAt: Date.now() + 20 * 3600e3 },
      booking_engine: null,
    });
    const { getToken } = await import('../../src/guesty/tokenCache');
    expect(await getToken('open_api')).toBe('tok_saved');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('an expired saved token is not used', async () => {
    process.env.GUESTY_TOKEN_CACHE = JSON.stringify({ open_api: { accessToken: 'tok_old', expiresAt: Date.now() - 1000 } });
    mockFetch.mockImplementation(minted('tok_new'));
    const { getToken } = await import('../../src/guesty/tokenCache');
    expect(await getToken('open_api')).toBe('tok_new');
  });

  it('a newly minted token is written to the service env through the Render API', async () => {
    mockFetch.mockImplementation(minted('tok_new'));
    const { getToken } = await import('../../src/guesty/tokenCache');
    await getToken('open_api');
    await new Promise((r) => setTimeout(r, 0));
    const put = mockFetch.mock.calls.find((c) => String(c[0]).includes('api.render.com'));
    expect(put?.[0]).toBe('https://api.render.com/v1/services/srv-test/env-vars/GUESTY_TOKEN_CACHE');
    expect(put?.[1].method).toBe('PUT');
    expect(JSON.parse(JSON.parse(put?.[1].body).value).open_api.accessToken).toBe('tok_new');
  });

  it('a 429 waits as long as Guesty says (ratelimit-reset), not just a minute', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, headers: { get: (h: string) => (h === 'ratelimit-reset' ? '1800' : null) } });
    const { getToken } = await import('../../src/guesty/tokenCache');
    await expect(getToken('open_api')).rejects.toThrow('HTTP 429');
    await expect(getToken('open_api')).rejects.toThrow(/cooling down for (17|18)\d\ds/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
