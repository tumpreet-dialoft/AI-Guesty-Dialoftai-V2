import { describe, it, expect } from 'vitest';
import { verifyRetellSignature, signLikeRetell } from '../../src/auth/retellSignature';

const KEY = 'key_test_webhook';
const BODY = '{"name":"lookup_reservation","args":{"guest_name":"Dana Osman"}}';
// retell-sdk 6.2.19 symmetric.sign(BODY, KEY, 1794000000000). Fails if our format drifts from Retell's.
const SDK_VECTOR = 'v=1794000000000,d=544cb508b5eaa9bb7234363a54da86cfa4ce9f8447ccbeb478ec4d891f1ad670';

describe('verifyRetellSignature (retell-sdk v6 format)', () => {
  it('signs exactly like the real SDK', () => {
    expect(signLikeRetell(BODY, KEY, 1_794_000_000_000)).toBe(SDK_VECTOR);
  });

  it('accepts a signature made the way Retell makes it', () => {
    expect(verifyRetellSignature(BODY, KEY, SDK_VECTOR, 1_794_000_000_000 + 1000)).toBe(true);
  });

  it('rejects the wrong key, a changed body, a stale stamp and junk', () => {
    const now = 1_794_000_000_000;
    expect(verifyRetellSignature(BODY, 'other_key', SDK_VECTOR, now)).toBe(false);
    expect(verifyRetellSignature(BODY.replace('Dana', 'Eve'), KEY, SDK_VECTOR, now)).toBe(false);
    expect(verifyRetellSignature(BODY, KEY, SDK_VECTOR, now + 6 * 60 * 1000)).toBe(false);
    expect(verifyRetellSignature(BODY, KEY, 'some-shared-secret', now)).toBe(false);
    expect(verifyRetellSignature(BODY, KEY, undefined, now)).toBe(false);
    expect(verifyRetellSignature(BODY, '', SDK_VECTOR, now)).toBe(false);
  });
});
