import { log } from '../logger';

export interface AvailableSuite {
  name: string;
  nightly: number;
}

export interface AvailabilityResult {
  available: boolean;
  suites: AvailableSuite[];
}

export function shapeAvailabilityFromListing(
  suiteName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listing: any,
): AvailableSuite | null {
  try {
    const allotment: Record<string, number> = listing.allotment ?? {};
    const allotmentValues = Object.values(allotment);
    if (allotmentValues.length === 0 || !allotmentValues.every((v) => v > 0)) {
      return null;
    }

    const nightlyRates: Record<string, number> = listing.nightlyRates ?? {};
    const rateValues = Object.values(nightlyRates);
    let nightly: number;
    if (rateValues.length > 0) {
      nightly = Math.round(rateValues.reduce((a, b) => a + b, 0) / rateValues.length);
    } else {
      nightly = listing.prices?.basePrice ?? 0;
    }

    if (nightly <= 0) {
      log.warn({ suiteName }, 'availability_no_nightly_rate');
      return null;
    }

    return { name: suiteName, nightly };
  } catch (err) {
    log.error({ err, suiteName }, 'availability_shaping_error');
    return null;
  }
}

export function buildAvailabilityResponse(suites: AvailableSuite[]): AvailabilityResult {
  return {
    available: suites.length > 0,
    suites,
  };
}
