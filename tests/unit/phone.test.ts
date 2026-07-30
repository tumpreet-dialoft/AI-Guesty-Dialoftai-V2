import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../src/util/phone';

describe('normalizePhone', () => {
  it('keeps an international number the caller gave with a plus', () => {
    expect(normalizePhone('+917986610238')).toBe('+917986610238');
    expect(normalizePhone('+1 903 426 8958')).toBe('+19034268958');
  });

  it('accepts the spoken and written shapes of a US number', () => {
    expect(normalizePhone('9034268958')).toBe('+19034268958');
    expect(normalizePhone('903 426 8958')).toBe('+19034268958');
    expect(normalizePhone('(903) 426-8958')).toBe('+19034268958');
    expect(normalizePhone('19034268958')).toBe('+19034268958');
  });

  it('rejects anything it cannot be sure about', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('12345')).toBeNull(); // too short to guess at
    expect(normalizePhone('798661023')).toBeNull(); // 9 digits, not a US number
    expect(normalizePhone('+0123456789')).toBeNull(); // no country code starts with 0
  });

  // The one assumption in here. A 10-digit international number typed without a
  // plus becomes a US number, and the link goes to a stranger.
  it('treats a bare 10-digit number as US, which is wrong for an overseas number', () => {
    expect(normalizePhone('7986610238')).toBe('+17986610238');
  });
});
