import { guestyFetch } from './client';
import { allEntries } from '../listings/map';
import {
  shapeAvailabilityFromListing,
  AvailableSuite,
  buildAvailabilityResponse,
  AvailabilityResult,
} from '../shapers/availability';
import { shapeQuote, ShapedQuote } from '../shapers/quote';

export async function checkAvailability(
  checkIn: string,
  checkOut: string,
  _guests: number,
): Promise<AvailabilityResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await guestyFetch(
    'booking_engine',
    'GET',
    `/listings?checkIn=${checkIn}&checkOut=${checkOut}&limit=50`,
  )) as any;

  const results = raw?.results ?? [];
  const entries = allEntries();
  const listingIdToName = new Map(entries.map((e) => [e.listingId, e.name]));
  const available: AvailableSuite[] = [];

  for (const listing of results) {
    const suiteName = listingIdToName.get(listing._id);
    if (!suiteName) continue;

    const shaped = shapeAvailabilityFromListing(suiteName, listing);
    if (shaped) {
      available.push(shaped);
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
  const raw = await guestyFetch('booking_engine', 'POST', '/reservations/quotes', {
    listingId,
    checkInDateLocalized: checkIn,
    checkOutDateLocalized: checkOut,
    guestsCount: guests,
  });

  console.log(listingId,typeof(listingId)," listid");

  const payload = { listingId, checkInDateLocalized: checkIn, checkOutDateLocalized: checkOut, guestsCount: guests };
console.log('📤 Sending to Guesty:', JSON.stringify(payload, null, 2));

  return shapeQuote(suiteName, raw);
}

