import { config } from '../config';

export const LISTING_MAP: Record<string, string> = config.LISTING_MAP;

export function resolveListingId(suiteName: string): string | null {
  return LISTING_MAP[suiteName] ?? null;
}

export function allSuiteNames(): string[] {
  return Object.keys(LISTING_MAP);
}

export function allEntries(): Array<{ name: string; listingId: string }> {
  return Object.entries(LISTING_MAP).map(([name, listingId]) => ({ name, listingId }));
}
