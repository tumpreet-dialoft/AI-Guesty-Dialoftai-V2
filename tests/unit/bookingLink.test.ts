import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
  config: {
    BOOKING_SITE: 'https://thethomastyler.guestybookings.com',
    LISTING_MAP: {
      'Garden Suite': 'lst_garden_123',
      'Premium Suite': 'lst_premium_456',
    },
  },
}));

import { buildBookingLink } from '../../src/links/bookingLink';

describe('buildBookingLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a link with correct listing ID, dates, and guests', () => {
    const link = buildBookingLink('Garden Suite', '2026-07-04', '2026-07-06', 2);
    expect(link).toBe(
      'https://thethomastyler.guestybookings.com/properties/lst_garden_123?checkIn=2026-07-04&checkOut=2026-07-06&minOccupancy=2',
    );
  });

  it('URL-encodes dates correctly', () => {
    const link = buildBookingLink('Premium Suite', '2026-07-04', '2026-07-06', 3);
    expect(link).toContain('checkIn=2026-07-04');
    expect(link).toContain('checkOut=2026-07-06');
    expect(link).toContain('minOccupancy=3');
    expect(link).toContain('lst_premium_456');
  });

  it('throws when suite name not in LISTING_MAP', () => {
    expect(() => buildBookingLink('Nonexistent Suite', '2026-07-04', '2026-07-06', 2)).toThrow(
      'Unknown suite',
    );
  });
});
