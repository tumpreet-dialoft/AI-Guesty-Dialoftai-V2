import { log } from '../logger';

export interface ShapedReservation {
  found: true;
  suite: string;
  check_in: string;
  check_out: string;
  status: string;
}

export type ReservationResult = ShapedReservation | { found: false };

// TODO: Verify field paths against live Guesty Open API reservations response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeReservation(raw: any): ReservationResult {
  try {
    if (!raw || (!raw.result && !raw._id)) {
      return { found: false };
    }

    const res = raw.result ?? raw;
    const suite = res?.listing?.title ?? res?.listingTitle ?? res?.nickname ?? 'Unknown Suite';
    const checkIn = res?.checkIn ?? res?.checkInDateLocalized ?? null;
    const checkOut = res?.checkOut ?? res?.checkOutDateLocalized ?? null;
    const status = res?.status ?? 'unknown';

    if (!checkIn || !checkOut) {
      log.warn({ hasCheckIn: !!checkIn, hasCheckOut: !!checkOut }, 'reservation_missing_dates');
      return { found: false };
    }

    return {
      found: true,
      suite: String(suite),
      check_in: String(checkIn).slice(0, 10),
      check_out: String(checkOut).slice(0, 10),
      status: String(status),
    };
  } catch (err) {
    log.error({ err }, 'reservation_shaping_error');
    return { found: false };
  }
}
