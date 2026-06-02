import { GuestyError } from '../errors';
import { log } from '../logger';
import { config } from '../config';

// Single-instance in-memory cache. For >1 instance, swap to Redis:
//   Store { accessToken, expiresAt } under a key per API.
//   Use a distributed lock (e.g. Redlock) to prevent thundering herd on refresh.

export type ApiType = 'booking_engine' | 'open_api';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

interface TokenCacheEntry {
  cached: CachedToken | null;
  inflight: Promise<CachedToken> | null;
}

const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const caches: Record<ApiType, TokenCacheEntry> = {
  booking_engine: { cached: null, inflight: null },
  open_api: { cached: null, inflight: null },
};

interface TokenEndpointConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

async function fetchToken(cfg: TokenEndpointConfig): Promise<CachedToken> {
  // TODO: Verify content-type against your Guesty account.
  // Some Guesty endpoints expect application/x-www-form-urlencoded, others JSON.
  // The Booking Engine API typically uses form-encoded. Adjust if needed.
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const resp = await fetch(`${cfg.baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    log.error({ status: resp.status, api: cfg.baseUrl }, 'token_fetch_failed');
    throw new GuestyError('token_fetch_failed', `HTTP ${resp.status} from token endpoint`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };

  if (!data.access_token || !data.expires_in) {
    throw new GuestyError('token_fetch_failed', 'Missing access_token or expires_in in response');
  }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

function isExpiredOrNearExpiry(entry: CachedToken): boolean {
  return Date.now() >= entry.expiresAt - PROACTIVE_REFRESH_BUFFER_MS;
}

export function getTokenEndpointConfig(api: ApiType): TokenEndpointConfig {
  if (api === 'booking_engine') {
    return {
      baseUrl: config.GUESTY_BE_BASE_URL,
      clientId: config.GUESTY_BE_CLIENT_ID,
      clientSecret: config.GUESTY_BE_CLIENT_SECRET,
    };
  }
  return {
    baseUrl: config.GUESTY_OAPI_BASE_URL,
    clientId: config.GUESTY_OAPI_CLIENT_ID,
    clientSecret: config.GUESTY_OAPI_CLIENT_SECRET,
  };
}

export async function getToken(api: ApiType): Promise<string> {
  const entry = caches[api];

  if (entry.cached && !isExpiredOrNearExpiry(entry.cached)) {
    return entry.cached.accessToken;
  }

  if (entry.inflight) {
    const result = await entry.inflight;
    return result.accessToken;
  }

  const cfg = getTokenEndpointConfig(api);
  const promise = fetchToken(cfg);
  entry.inflight = promise;

  try {
    const result = await promise;
    entry.cached = result;
    log.info({ api }, 'token_refreshed');
    return result.accessToken;
  } catch (err) {
    entry.cached = null;
    throw err;
  } finally {
    entry.inflight = null;
  }
}

export function invalidateToken(api: ApiType): void {
  caches[api].cached = null;
}

export function _resetForTest(): void {
  for (const key of Object.keys(caches) as ApiType[]) {
    caches[key].cached = null;
    caches[key].inflight = null;
  }
}
