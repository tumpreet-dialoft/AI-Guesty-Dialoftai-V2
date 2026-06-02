import { guestyFetch } from './client';
import { allEntries } from '../listings/map';
import { shapeAvailability, AvailableSuite, buildAvailabilityResponse, AvailabilityResult } from '../shapers/availability';
import { shapeQuote, ShapedQuote } from '../shapers/quote';
import { log } from '../logger';

// TODO: Verify the exact Booking Engine availability endpoint path.
// This may be /availability/calendar, /listings/{id}/availability, or similar.
// Check your Guesty Booking Engine API docs for the active version.
const AVAILABILITY_PATH = '/availability';

// TODO: Verify the exact Booking Engine quote endpoint path.
// This may be /quotes, /reservations/quote, or similar.
const QUOTE_PATH = '/quotes';

export async function checkAvailability(
  checkIn: string,
  checkOut: string,
  guests: number,
): Promise<AvailabilityResult> {
  const entries = allEntries();
  const available: AvailableSuite[] = [];

  // Sequential — never fan out parallel Guesty calls within one request
  for (const entry of entries) {
    try {
      const raw = await guestyFetch(
        'booking_engine',
        'GET',
        `${AVAILABILITY_PATH}?listingId=${entry.listingId}&checkIn=${checkIn}&checkOut=${checkOut}&guestsCount=${guests}`,
      );
      const shaped = shapeAvailability(entry.name, raw);
      if (shaped) {
        available.push(shaped);
      }
    } catch (err) {
      log.warn({ err, suite: entry.name }, 'availability_check_failed_for_suite');
    }
  }

  return buildAvailabilityResponse(available);
}

export async function getQuote(
  listingId: string,
  suiteName: string,
  checkIn: string,
  checkOut: string,
  guests: number,
): Promise<ShapedQuote | null> {
  const raw = await guestyFetch('booking_engine', 'POST', QUOTE_PATH, {
    listingId,
    checkIn,
    checkOut,
    guestsCount: guests,
  });

  return shapeQuote(suiteName, raw);
}
