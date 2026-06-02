import { config } from '../config';
import { resolveListingId } from '../listings/map';

// TODO: Verify these query-parameter names against a real URL copied from the live
// thethomastyler.guestybookings.com site. They may be different (e.g. "adults"
// instead of "minOccupancy", or "checkin" vs "checkIn").
const PARAM_CHECK_IN = 'checkIn';
const PARAM_CHECK_OUT = 'checkOut';
const PARAM_GUESTS = 'minOccupancy';

export function buildBookingLink(
  suiteName: string,
  checkIn: string,
  checkOut: string,
  guests: number,
): string {
  const listingId = resolveListingId(suiteName);
  if (!listingId) {
    throw new Error(`Unknown suite: ${suiteName}`);
  }

  const base = config.BOOKING_SITE.replace(/\/$/, '');
  const params = new URLSearchParams({
    [PARAM_CHECK_IN]: checkIn,
    [PARAM_CHECK_OUT]: checkOut,
    [PARAM_GUESTS]: String(guests),
  });

  return `${base}/properties/${listingId}?${params.toString()}`;
}
