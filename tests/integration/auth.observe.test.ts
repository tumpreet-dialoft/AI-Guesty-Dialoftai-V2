import './setup.observe';
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

describe('RETELL_AUTH_MODE=secret with a signing key set (observe only)', () => {
  it('still accepts the shared secret, and counts the signature', async () => {
    const res = await post(app, '/check_availability', fnBody)
      .set('x-retell-secret', 'test-secret-123')
      .set('x-retell-signature', signLikeRetell(raw(fnBody), KEY));
    expect(res.status).not.toBe(401);
    const s = await request(app).get('/auth-status');
    expect(s.body.mode).toBe('secret');
    expect(s.body.functions.valid).toBe(1);
  });

  it('a signature alone is not enough until the mode is switched', async () => {
    const res = await post(app, '/check_availability', fnBody).set(
      'x-retell-signature',
      signLikeRetell(raw(fnBody), KEY),
    );
    expect(res.status).toBe(401);
  });

  it('never drops a post-call webhook in this mode, even unsigned', async () => {
    expect((await post(app, '/post_call', callBody)).status).toBe(200);
    const s = await request(app).get('/auth-status');
    expect(s.body.post_call.missing).toBe(1);
  });
});
