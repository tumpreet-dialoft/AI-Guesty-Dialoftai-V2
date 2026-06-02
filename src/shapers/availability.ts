import { log } from '../logger';

export interface AvailableSuite {
  name: string;
  nightly: number;
}

export interface AvailabilityResult {
  available: boolean;
  suites: AvailableSuite[];
}

// TODO: Verify field paths against the live Guesty Booking Engine availability response.
// The shape below is illustrative. Adjust property access paths once you see a real payload.
export function shapeAvailability(
  suiteName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawResponse: any,
): AvailableSuite | null {
  try {
    const isAvailable = rawResponse?.available ?? rawResponse?.data?.available ?? false;
    if (!isAvailable) return null;

    const nightly =
      rawResponse?.rates?.basePrice ??
      rawResponse?.data?.rates?.basePrice ??
      rawResponse?.price?.basePrice ??
      null;

    if (nightly === null || nightly === undefined) {
      log.warn({ suiteName }, 'availability_missing_nightly_rate');
      return null;
    }

    return {
      name: suiteName,
      nightly: Math.round(Number(nightly)),
    };
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
