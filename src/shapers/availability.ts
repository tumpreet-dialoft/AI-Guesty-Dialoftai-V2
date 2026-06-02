import { log } from '../logger';

export interface AvailableSuite {
  name: string;
  nightly: number;
}

export interface AvailabilityResult {
  available: boolean;
  suites: AvailableSuite[];
}

interface CalendarDay {
  date: string;
  status: string;
}

export function shapeAvailability(
  suiteName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawResponse: any,
  basePrice: number,
): AvailableSuite | null {
  try {
    if (!Array.isArray(rawResponse) || rawResponse.length === 0) {
      return null;
    }

    const days = rawResponse as CalendarDay[];
    const allAvailable = days.every((d) => d.status === 'available');
    if (!allAvailable) return null;

    if (basePrice <= 0) {
      log.warn({ suiteName }, 'availability_no_base_price');
      return null;
    }

    return { name: suiteName, nightly: Math.round(basePrice) };
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
