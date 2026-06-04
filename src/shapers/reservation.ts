import { log } from '../logger';
import { LISTING_MAP } from '../listings/map';

export interface ShapedReservation {
  found: true;
  status: string;
  suite: string;
  check_in: string | null;
  check_out: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  source: string;
  totalPaid: number | null;
  balanceDue: number | null;
  isOtaBooking: boolean;
}

export type ReservationResult = ShapedReservation | { found: false };

// LISTING_MAP is suite name -> listingId; build the reverse (listingId -> suite name).
const LISTING_ID_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(LISTING_MAP).map(([name, listingId]) => [listingId, name]),
);

const OTA_SOURCES = [
  'airbnb',
  'booking.com',
  'vrbo',
  'homeaway',
  'expedia',
  'tripadvisor',
  'agoda',
  'hotels.com',
];

function isOtaSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return OTA_SOURCES.some((ota) => s.includes(ota));
}

// TODO: Field paths mirror the working V1 searchBooking mapping against the
// Guesty Open API GET /reservations/{id} response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeReservation(raw: any): ReservationResult {
  try {
    const res = raw?.result ?? raw;
    if (!res || !res._id) {
      return { found: false };
    }

    const listingId: string | undefined = res?.listing?._id;
    const parentId: string | undefined = res?.listing?.mtl?.p ?? res?.unitTypeId;
    const suite =
      (listingId && LISTING_ID_TO_NAME[listingId]) ||
      (parentId && LISTING_ID_TO_NAME[parentId]) ||
      res?.listing?.title ||
      'N/A';

    const source: string = res?.source ?? 'direct';

    return {
      found: true,
      status: String(res?.status ?? 'unknown'),
      suite: String(suite),
      check_in: res?.checkInDateLocalized ?? null,
      check_out: res?.checkOutDateLocalized ?? null,
      guest_name: res?.guest?.fullName ?? 'N/A',
      guest_email: res?.guest?.email ?? null,
      guest_phone: res?.guest?.phone ?? null,
      source,
      totalPaid: res?.money?.totalPaid ?? null,
      balanceDue: res?.money?.balanceDue ?? null,
      isOtaBooking: isOtaSource(source),
    };
  } catch (err) {
    log.error({ err }, 'reservation_shaping_error');
    return { found: false };
  }
}
