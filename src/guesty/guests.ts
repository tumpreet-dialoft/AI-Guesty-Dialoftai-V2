import { guestyFetch } from './client';
import { log } from '../logger';

// Guesty Open API base URL already includes /v1 (config.GUESTY_OAPI_BASE_URL).
const GUESTS_PATH = '/guests';

// GET /guests returns { results: [...] } directly.
interface GuestSearchResponse {
  results?: { _id: string }[];
}

// POST /guests returns the created guest object directly (with _id).
interface GuestCreateResponse {
  _id?: string;
}

// Finds an existing guest by phone via Guesty's text search (`q=`), newest
// first. Returns the guest _id or null. Lets us reuse an existing guest profile
// instead of creating a duplicate.
//
// IMPORTANT (verified live): Guesty stores phones as digits only (no leading
// `+`), and `q=+9195...` matches NOTHING while `q=9195...` matches. We strip all
// non-digits before searching, otherwise every returning guest is misdetected as
// new and we create duplicate guests/inquiries on each call.
export async function findGuestIdByPhone(phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${GUESTS_PATH}?q=${encodeURIComponent(digits)}&fields=_id&limit=1&sort=-createdAt`,
  )) as GuestSearchResponse | null;
  return data?.results?.[0]?._id ?? null;
}

// Splits a display name into the firstName/lastName that POST /guests persists.
// (Verified live: a `fullName` field is ignored; firstName/lastName populate it.)
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Guest', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Creates a minimal guest profile for a new prospect so an inquiry/conversation
// can be attached to it. Returns the new guest _id, or null on failure.
export async function createGuest(params: {
  fullName: string;
  phone: string;
}): Promise<string | null> {
  try {
    const { firstName, lastName } = splitName(params.fullName);
    const data = (await guestyFetch('open_api', 'POST', GUESTS_PATH, {
      firstName,
      lastName,
      phone: params.phone,
    })) as GuestCreateResponse | null;
    const id = data?._id ?? null;
    if (id) {
      log.info({ guestId: id }, 'guesty_guest_created');
    }
    return id;
  } catch (err) {
    log.error({ err }, 'guesty_guest_create_failed');
    return null;
  }
}
