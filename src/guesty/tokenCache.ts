import fs from 'fs';
import os from 'os';
import path from 'path';
import { GuestyError } from '../errors';
import { log } from '../logger';
import { config } from '../config';

export type ApiType = 'booking_engine' | 'open_api';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenCacheEntry {
  cached: CachedToken | null;
  inflight: Promise<CachedToken> | null;
  blockedUntil: number;
}

const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Guesty rate-limits /oauth2/token hard, and a 429 there is not something a retry
// fixes — each further attempt extends the block. Refuse to call the endpoint at all
// for a while after it fails, so a burst of traffic cannot dig the hole deeper.
const TOKEN_FAILURE_COOLDOWN_MS = 60 * 1000;

// os.tmpdir() so this survives restarts on Windows too. A hardcoded '/tmp' resolves
// to <drive>:\tmp there, which does not exist, so every save failed silently and every
// dev-server restart burned a fresh token off Guesty's rate-limited token endpoint.
const TOKEN_FILE = path.join(os.tmpdir(), 'guesty-tokens.json');

const caches: Record<ApiType, TokenCacheEntry> = {
  booking_engine: { cached: null, inflight: null, blockedUntil: 0 },
  open_api: { cached: null, inflight: null, blockedUntil: 0 },
};

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    for (const api of ['booking_engine', 'open_api'] as ApiType[]) {
      if (raw[api]?.accessToken && raw[api]?.expiresAt) {
        caches[api].cached = {
          accessToken: raw[api].accessToken,
          expiresAt: raw[api].expiresAt,
        };
        log.info({ api }, 'token_loaded_from_disk');
      }
    }
  } catch (err) {
    log.warn({ err, file: TOKEN_FILE }, 'token_disk_load_failed');
  }
}

function saveToDisk(): void {
  try {
    const data: Record<string, CachedToken | null> = {};
    for (const api of ['booking_engine', 'open_api'] as ApiType[]) {
      data[api] = caches[api].cached;
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    log.warn({ err, file: TOKEN_FILE }, 'token_disk_save_failed');
  }
}

loadFromDisk();

interface TokenEndpointConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

async function fetchToken(cfg: TokenEndpointConfig): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const resp = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    log.error({ status: resp.status, api: cfg.tokenUrl }, 'token_fetch_failed');
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
      tokenUrl: config.GUESTY_BE_TOKEN_URL,
      clientId: config.GUESTY_BE_CLIENT_ID,
      clientSecret: config.GUESTY_BE_CLIENT_SECRET,
    };
  }
  return {
    tokenUrl: config.GUESTY_OAPI_TOKEN_URL,
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

  if (Date.now() < entry.blockedUntil) {
    const waitSec = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
    throw new GuestyError(
      'token_fetch_failed',
      `Token endpoint cooling down for ${waitSec}s after a failure`,
    );
  }

  const cfg = getTokenEndpointConfig(api);
  const promise = fetchToken(cfg);
  entry.inflight = promise;

  try {
    const result = await promise;
    entry.cached = result;
    saveToDisk();
    log.info({ api }, 'token_refreshed');
    return result.accessToken;
  } catch (err) {
    entry.cached = null;
    entry.blockedUntil = Date.now() + TOKEN_FAILURE_COOLDOWN_MS;
    throw err;
  } finally {
    entry.inflight = null;
  }
}

export function invalidateToken(api: ApiType): void {
  caches[api].cached = null;
  saveToDisk();
}

export function _resetForTest(): void {
  for (const key of Object.keys(caches) as ApiType[]) {
    caches[key].cached = null;
    caches[key].inflight = null;
    caches[key].blockedUntil = 0;
  }
}
