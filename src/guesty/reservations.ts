import { guestyFetch } from './client';
import { log } from '../logger';

// Guesty Open API base URL already includes /v1 (config.GUESTY_OAPI_BASE_URL).
const RESERVATIONS_PATH = '/reservations';

interface ReservationCreateResponse {
  _id?: string;
}

// Creates an `inquiry` reservation (a lead — no blocked dates) so Guesty spawns
// a conversation we can message. Used only for brand-new prospects who have no
// existing Guesty conversation. Pass `guestId` to reuse a known guest, or
// `guest` (inline) to let Guesty create one. Returns the reservation _id or null.
//
// Date/field conventions mirror src/guesty/bookingEngine.ts getQuote()
// (checkInDateLocalized / guestsCount).
//
// Verified live: this payload returns 200 with the reservation _id and Guesty
// auto-spawns a conversation for the new inquiry shortly after.
export async function createInquiryReservation(params: {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  guestId?: string;
  guest?: { fullName: string; phone: string };
}): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      listingId: params.listingId,
      checkInDateLocalized: params.checkIn,
      checkOutDateLocalized: params.checkOut,
      guestsCount: params.guests,
      status: 'inquiry',
    };
    if (params.guestId) {
      body.guestId = params.guestId;
    } else if (params.guest) {
      body.guest = params.guest;
    }

    const data = (await guestyFetch(
      'open_api',
      'POST',
      RESERVATIONS_PATH,
      body,
    )) as ReservationCreateResponse | null;

    const id = data?._id ?? null;
    if (id) {
      log.info({ reservationId: id }, 'guesty_inquiry_created');
    }
    return id;
  } catch (err) {
    log.error({ err }, 'guesty_inquiry_create_failed');
    return null;
  }
}
