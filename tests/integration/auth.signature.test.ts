import './setup.signature';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { signLikeRetell, resetCountsForTest } from '../../src/auth/retellSignature';
import { _resetForTest } from '../../src/guesty/tokenCache';
import { KEY, fnBody, callBody, raw, stubFetch, post } from './authHelpers';

beforeEach(() => {
  _resetForTest();
  resetCountsForTest();
  stubFetch();
});

describe('RETELL_AUTH_MODE=signature', () => {
  it('lets in a function call that Retell signed, with no shared secret', async () => {
    const res = await post(app, '/check_availability', fnBody).set(
      'x-retell-signature',
      signLikeRetell(raw(fnBody), KEY),
    );
    expect(res.status).not.toBe(401);
  });

  it('blocks the leaked placeholder secret when there is no signature', async () => {
    const res = await post(app, '/check_availability', fnBody).set('x-retell-secret', 'test-secret-123');
    expect(res.status).toBe(401);
  });

  it('blocks a stale or forged signature', async () => {
    const stale = signLikeRetell(raw(fnBody), KEY, Date.now() - 10 * 60 * 1000);
    expect((await post(app, '/check_availability', fnBody).set('x-retell-signature', stale)).status).toBe(401);
    const forged = signLikeRetell(raw(fnBody), 'guess');
    expect((await post(app, '/lookup_reservation', fnBody).set('x-retell-signature', forged)).status).toBe(401);
  });

  it('enforces the signature on the post-call webhook too', async () => {
    expect((await post(app, '/post_call', callBody)).status).toBe(401);
    const ok = await post(app, '/post_call', callBody).set('x-retell-signature', signLikeRetell(raw(callBody), KEY));
    expect(ok.status).toBe(200);
  });

  it('reports counts at /auth-status and never the key', async () => {
    await post(app, '/check_availability', fnBody).set('x-retell-signature', signLikeRetell(raw(fnBody), KEY));
    await post(app, '/check_availability', fnBody);
    const s = await request(app).get('/auth-status');
    expect(s.body.mode).toBe('signature');
    expect(s.body.signature_key_set).toBe(true);
    expect(s.body.functions.valid).toBe(1);
    expect(s.body.functions.missing).toBe(1);
    expect(JSON.stringify(s.body)).not.toContain(KEY);
  });
});
