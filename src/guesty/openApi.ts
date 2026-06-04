import { guestyFetch } from './client';
import { shapeReservation, ReservationResult } from '../shapers/reservation';

// Guesty Open API base URL already includes /v1 (see config.GUESTY_OAPI_BASE_URL),
// so reservation paths are relative to it.
const RESERVATIONS_PATH = '/reservations';

interface ReservationIdResult {
  _id: string;
}

interface ReservationSearchResponse {
  results?: ReservationIdResult[];
}

// Mirrors the proven V1 searchBooking flow (confirmation-code only):
//   1. Exact match on confirmationCode via filters ($eq).
//   2. Fetch the full reservation by _id to get the detail fields.
export async function lookupReservation(params: {
  confirmationCode: string;
}): Promise<ReservationResult> {
  const filters = JSON.stringify([
    { field: 'confirmationCode', operator: '$eq', value: params.confirmationCode },
  ]);
  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${RESERVATIONS_PATH}?fields=_id&limit=5&filters=${encodeURIComponent(filters)}`,
  )) as ReservationSearchResponse | null;

  const matchedIds = (data?.results ?? []).map((r) => r._id);
  if (matchedIds.length === 0) {
    return { found: false };
  }

  const raw = await guestyFetch('open_api', 'GET', `${RESERVATIONS_PATH}/${matchedIds[0]}`);
  return shapeReservation(raw);
}
