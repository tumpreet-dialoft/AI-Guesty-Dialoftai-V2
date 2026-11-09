import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGuestyFetch = vi.fn();
const mockTwilioCreate = vi.fn();

vi.mock('../../src/guesty/client', () => ({
  guestyFetch: (...args: unknown[]) => mockGuestyFetch(...args),
}));
vi.mock('../../src/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/config', () => ({
  config: { TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'x', TWILIO_FROM: '+15550100000' },
}));
vi.mock('twilio', () => ({
  default: () => ({ messages: { create: (...a: unknown[]) => mockTwilioCreate(...a) } }),
}));

import { pickMatch, attachPhoneToGuest, ReservationSummary } from '../../src/guesty/reservationSearch';
import { sendGuestySms } from '../../src/guesty/communication';
import { sendSms } from '../../src/twilio/sms';
import { isTestBody, withTestMode } from '../../src/util/testMode';

function res(over: Partial<ReservationSummary>): ReservationSummary {
  return {
    reservation_id: 'r',
    confirmation_code: 'C',
    guest_first_name: 'Dana',
    guest_full_name: 'Dana Osman',
    suite: 'Garden Suite',
    check_in: '2026-11-07',
    check_out: '2026-11-09',
    status: 'confirmed',
    source: 'direct',
    is_ota: false,
    guest_status: 'upcoming',
    has_email_on_file: true,
    ...over,
  };
}

describe('pickMatch', () => {
  it('one guest with several stays is not ambiguous: the current stay wins over an old one', () => {
    const july = res({ reservation_id: 'july', guest_status: 'departed', check_in: '2026-07-10', check_out: '2026-07-12' });
    const today = res({ reservation_id: 'today', guest_status: 'in_house' });
    expect(pickMatch([july, today])).toEqual({ found: today, ambiguous: false });
  });

  it('two different people with similar names is ambiguous', () => {
    const a = res({ reservation_id: 'a', guest_full_name: 'Dana Osman' });
    const b = res({ reservation_id: 'b', guest_full_name: 'Dana Ossman' });
    expect(pickMatch([a, b]).ambiguous).toBe(true);
  });

  it('handles none and one', () => {
    expect(pickMatch([])).toEqual({ found: null, ambiguous: false });
    const only = res({});
    expect(pickMatch([only]).found).toBe(only);
  });
});

describe('test mode', () => {
  beforeEach(() => {
    mockGuestyFetch.mockReset();
    mockTwilioCreate.mockReset();
  });

  it('recognises playground calls, test_mode variables and metadata', () => {
    expect(isTestBody({ call: { call_id: 'playground' } })).toBe(true);
    expect(isTestBody({ call: { call_id: 'c1', retell_llm_dynamic_variables: { test_mode: 'true' } } })).toBe(true);
    expect(isTestBody({ chat: { chat_id: 'x', retell_llm_dynamic_variables: { test_mode: 'TRUE' } } })).toBe(true);
    expect(isTestBody({ call: { call_id: 'c1', metadata: { test_mode: true } } })).toBe(true);
    expect(isTestBody({ call: { call_id: 'c1', retell_llm_dynamic_variables: { test_mode: 'false' } } })).toBe(false);
    expect(isTestBody({})).toBe(false);
  });

  it('suppresses texts, Guesty messages and the phone backfill, and reports success', async () => {
    await withTestMode(true, async () => {
      expect(await sendSms('+19035550123', 'hi')).toBe(true);
      expect(await sendGuestySms('conv_1', 'hi')).toBe(true);
      await attachPhoneToGuest('r1', '+19035550123');
    });
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(mockGuestyFetch).not.toHaveBeenCalled();
  });

  it('sends for real outside test mode', async () => {
    mockTwilioCreate.mockResolvedValue({ sid: 'SM1' });
    mockGuestyFetch.mockResolvedValue({});
    await withTestMode(false, async () => {
      expect(await sendSms('+19035550123', 'hi')).toBe(true);
      expect(await sendGuestySms('conv_1', 'hi')).toBe(true);
    });
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(mockGuestyFetch).toHaveBeenCalledTimes(1);
  });
});

describe('test mode: booking link via Guesty', () => {
  it('creates no guest, inquiry or message in Guesty', async () => {
    mockGuestyFetch.mockReset();
    const { sendBookingLinkViaGuesty } = await import('../../src/guesty/bookingSms');
    const ok = await withTestMode(true, () =>
      sendBookingLinkViaGuesty({ phone: '+19035550123', guestName: 'Guest', listingId: 'lst', checkIn: '2026-12-03',
        checkOut: '2026-12-05', guests: 2, body: 'x' }),
    );
    expect(ok).toBe(true);
    expect(mockGuestyFetch).not.toHaveBeenCalled();
  });
});
