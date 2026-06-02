import { guestyFetch } from './client';
import { allEntries } from '../listings/map';
import {
  shapeAvailability,
  AvailableSuite,
  buildAvailabilityResponse,
  AvailabilityResult,
} from '../shapers/availability';
import { shapeQuote, ShapedQuote } from '../shapers/quote';
import { log } from '../logger';

interface ListingPriceInfo {
  basePrice: number;
}

let listingPriceCache: Record<string, ListingPriceInfo> | null = null;

async function getListingPrices(): Promise<Record<string, ListingPriceInfo>> {
  if (listingPriceCache) return listingPriceCache;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await guestyFetch('booking_engine', 'GET', '/listings?limit=50')) as any;
  const results = raw?.results ?? [];
  const cache: Record<string, ListingPriceInfo> = {};
  for (const listing of results) {
    if (listing._id && listing.prices?.basePrice) {
      cache[listing._id] = { basePrice: listing.prices.basePrice };
    }
  }
  listingPriceCache = cache;
  return cache;
}

export async function checkAvailability(
  checkIn: string,
  checkOut: string,
  _guests: number,
): Promise<AvailabilityResult> {
  const entries = allEntries();
  const available: AvailableSuite[] = [];

  let prices: Record<string, ListingPriceInfo>;
  try {
    prices = await getListingPrices();
  } catch (err) {
    log.error({ err }, 'failed_to_fetch_listing_prices');
    prices = {};
  }

  for (const entry of entries) {
    try {
      const raw = await guestyFetch(
        'booking_engine',
        'GET',
        `/listings/${entry.listingId}/calendar?from=${checkIn}&to=${checkOut}`,
      );
      const basePrice = prices[entry.listingId]?.basePrice ?? 0;
      const shaped = shapeAvailability(entry.name, raw, basePrice);
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
  const raw = await guestyFetch('booking_engine', 'POST', '/reservations/quotes', {
    listingId,
    checkInDateLocalized: checkIn,
    checkOutDateLocalized: checkOut,
    guestsCount: guests,
  });

  return shapeQuote(suiteName, raw);
}

export function _resetListingPriceCacheForTest(): void {
  listingPriceCache = null;
}
