import crypto from 'crypto';
import { Request } from 'express';

// Retell's request signature, as produced by retell-sdk `sign` (v6):
//   x-retell-signature: v=<unix ms>,d=<hex HMAC-SHA256(rawBody + <unix ms>, apiKey)>
// The key is the Retell API key with the webhook badge. Requests older or newer
// than five minutes are refused, so a captured request cannot be replayed later.
// Docs: https://docs.retellai.com/build/single-multi-prompt/custom-function#verify-the-request-is-from-retell

const FIVE_MINUTES = 5 * 60 * 1000;

export function verifyRetellSignature(
  rawBody: string,
  secret: string,
  signature: unknown,
  now: number = Date.now(),
): boolean {
  if (!secret || typeof signature !== 'string') return false;
  const m = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!m) return false;
  const stamp = Number(m[1]);
  if (!Number.isSafeInteger(stamp) || Math.abs(now - stamp) > FIVE_MINUTES) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody + stamp).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Same format as retell-sdk `sign`; used by tests. */
export function signLikeRetell(rawBody: string, secret: string, stamp: number = Date.now()): string {
  const d = crypto.createHmac('sha256', secret).update(rawBody + stamp).digest('hex');
  return `v=${stamp},d=${d}`;
}

/** The exact bytes Retell signed. express.json() keeps them on req.rawBody (see index.ts). */
export function rawBodyOf(req: Request): string {
  const raw = (req as Request & { rawBody?: string }).rawBody;
  return typeof raw === 'string' ? raw : '';
}

// Counters for GET /auth-status, so whoever flips RETELL_AUTH_MODE can see first that
// real Retell requests verify. Counts only, never headers or bodies.
type Outcome = 'valid' | 'invalid' | 'missing' | 'unchecked';
const started = new Date().toISOString();
const counts: Record<'functions' | 'post_call', Record<Outcome, number>> = {
  functions: { valid: 0, invalid: 0, missing: 0, unchecked: 0 },
  post_call: { valid: 0, invalid: 0, missing: 0, unchecked: 0 },
};

export function checkAndCount(
  kind: 'functions' | 'post_call',
  req: Request,
  secret: string,
): boolean {
  const sig = req.headers['x-retell-signature'];
  let outcome: Outcome;
  let ok = false;
  if (!secret) outcome = 'unchecked';
  else if (typeof sig !== 'string' || sig.length === 0) outcome = 'missing';
  else {
    ok = verifyRetellSignature(rawBodyOf(req), secret, sig);
    outcome = ok ? 'valid' : 'invalid';
  }
  counts[kind][outcome] += 1;
  return ok;
}

export function authStatus(mode: string, secretSet: boolean) {
  return { mode, signature_key_set: secretSet, counting_since: started, ...counts };
}

export function resetCountsForTest(): void {
  for (const k of Object.values(counts)) for (const o of Object.keys(k) as Outcome[]) k[o] = 0;
}
