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

// Search reservation _ids, newest first. `query` is an already-encoded query
// string fragment (e.g. `filters=...` or `q=...`).
async function searchReservationIds(query: string): Promise<string[]> {
  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${RESERVATIONS_PATH}?fields=_id&limit=10&sort=-createdAt&${query}`,
  )) as ReservationSearchResponse | null;
  return (data?.results ?? []).map((r) => r._id);
}

// Looks up a single reservation by whatever identifier the caller has.
// Priority cascade (most precise first):
//   1. confirmation_code -> exact filter match ($eq)   [proven in V1]
//   2. email -> phone -> name -> Guesty broad text search (q=)
// Results are sorted newest-first; we always return only the latest match.
export async function lookupReservation(params: {
  confirmationCode?: string;
  email?: string;
  phone?: string;
  guestName?: string;
}): Promise<ReservationResult> {
  let matchedIds: string[] = [];

  // 1. Exact match on confirmation code — most reliable, unique.
  if (params.confirmationCode) {
    const filters = JSON.stringify([
      { field: 'confirmationCode', operator: '$eq', value: params.confirmationCode },
    ]);
    matchedIds = await searchReservationIds(`filters=${encodeURIComponent(filters)}`);
  }

  // 2. Fall back to Guesty's broad text search, trying each identifier in
  //    priority order until one yields a match.
  if (matchedIds.length === 0) {
    const terms = [params.email, params.phone, params.guestName].filter(
      (t): t is string => Boolean(t && t.trim()),
    );
    for (const term of terms) {
      matchedIds = await searchReservationIds(`q=${encodeURIComponent(term)}`);
      if (matchedIds.length > 0) break;
    }
  }

  if (matchedIds.length === 0) {
    return { found: false };
  }

  // Newest-first sort means index 0 is the latest reservation — return only it.
  const raw = await guestyFetch('open_api', 'GET', `${RESERVATIONS_PATH}/${matchedIds[0]}`);
  return shapeReservation(raw);
}
