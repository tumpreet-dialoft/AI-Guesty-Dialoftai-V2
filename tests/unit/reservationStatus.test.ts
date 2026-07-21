import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveGuestStatus } from '../../src/util/stayStatus';

// guest_status is the most consequential field in the system: it decides whether a
// caller gets asked for a confirmation code, or gets transferred to a human instantly
// because they are locked out of their room.
describe('deriveGuestStatus', () => {
  afterEach(() => vi.useRealTimers());

  const freezeTyler = (utcIso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(utcIso));
  };

  it('is upcoming before arrival', () => {
    freezeTyler('2026-07-01T12:00:00Z');
    expect(deriveGuestStatus('2026-07-10', '2026-07-14')).toBe('upcoming');
  });

  it('is in_house on the arrival day itself', () => {
    freezeTyler('2026-07-10T18:00:00Z');
    expect(deriveGuestStatus('2026-07-10', '2026-07-14')).toBe('in_house');
  });

  it('is in_house mid-stay', () => {
    freezeTyler('2026-07-12T09:00:00Z');
    expect(deriveGuestStatus('2026-07-10', '2026-07-14')).toBe('in_house');
  });

  it('is still in_house on checkout morning', () => {
    freezeTyler('2026-07-14T13:00:00Z');
    expect(deriveGuestStatus('2026-07-10', '2026-07-14')).toBe('in_house');
  });

  it('is departed after checkout', () => {
    freezeTyler('2026-07-15T12:00:00Z');
    expect(deriveGuestStatus('2026-07-10', '2026-07-14')).toBe('departed');
  });

  // Render runs on UTC, Tyler is on Central. At 02:00 UTC it is still yesterday in
  // Texas. Get this wrong and a guest is marked departed while they are asleep in
  // the building, and a lockout call at 2am gets routed as a receipt request.
  it('uses Tyler time, not the server clock', () => {
    freezeTyler('2026-07-15T02:00:00Z'); // 9pm Jul 14 in Tyler
    expect(deriveGuestStatus('2026-07-10', '2026-07-14')).toBe('in_house');
  });

  it('is none when there are no dates', () => {
    expect(deriveGuestStatus(null, null)).toBe('none');
  });
});
