import { GuestyError } from '../errors';
import { log } from '../logger';
import { config } from '../config';
import { sleep } from '../util/sleep';
import { jitter } from '../util/jitter';
import { getToken, invalidateToken, ApiType } from './tokenCache';

const REQUEST_TIMEOUT_MS = 6000;
const MAX_429_RETRIES = 3;
const MAX_5XX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

export async function guestyFetch(
  api: ApiType,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const baseUrl = api === 'booking_engine' ? config.GUESTY_BE_BASE_URL : config.GUESTY_OAPI_BASE_URL;
  const url = `${baseUrl}${path}`;

  let retries429 = 0;
  let retries5xx = 0;
  let authRetried = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const token = await getToken(api);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        retries5xx++;
        if (retries5xx > MAX_5XX_RETRIES) {
          throw new GuestyError('timeout', `Request to ${path} timed out after retries`);
        }
        const delay = BACKOFF_BASE_MS * Math.pow(2, retries5xx - 1) + jitter();
        log.warn({ path, attempt: retries5xx }, 'timeout_retry');
        await sleep(delay);
        continue;
      }
      retries5xx++;
      if (retries5xx > MAX_5XX_RETRIES) {
        throw new GuestyError('upstream_error', `Network error on ${path}: ${String(err)}`);
      }
      const delay = BACKOFF_BASE_MS * Math.pow(2, retries5xx - 1) + jitter();
      log.warn({ path, attempt: retries5xx, err: String(err) }, 'network_error_retry');
      await sleep(delay);
      continue;
    } finally {
      clearTimeout(timeoutId);
    }

    if (resp.status === 401 || resp.status === 403) {
      if (authRetried) {
        throw new GuestyError('auth_failed', `${resp.status} after token refresh on ${path}`);
      }
      authRetried = true;
      invalidateToken(api);
      log.warn({ path, status: resp.status }, 'auth_failed_refreshing');
      continue;
    }

    if (resp.status === 429) {
      retries429++;
      if (retries429 > MAX_429_RETRIES) {
        throw new GuestyError('rate_limited', `429 after ${MAX_429_RETRIES} retries on ${path}`);
      }
      const retryAfter = parseInt(resp.headers.get('Retry-After') ?? '1', 10);
      const delay = retryAfter * 1000 + jitter();
      log.warn({ path, retryAfter, attempt: retries429 }, 'rate_limited_retry');
      await sleep(delay);
      continue;
    }

    if (resp.status >= 500) {
      retries5xx++;
      if (retries5xx > MAX_5XX_RETRIES) {
        throw new GuestyError('upstream_error', `${resp.status} after retries on ${path}`);
      }
      const delay = BACKOFF_BASE_MS * Math.pow(2, retries5xx - 1) + jitter();
      log.warn({ path, status: resp.status, attempt: retries5xx }, '5xx_retry');
      await sleep(delay);
      continue;
    }

    if (!resp.ok) {
      throw new GuestyError('bad_response', `Unexpected status ${resp.status} on ${path}`);
    }

    log.info({ path, status: resp.status, api, method }, 'guesty_response');

    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new GuestyError('bad_response', `Non-JSON response from ${path}`);
    }
  }
}
