import { guestyFetch } from './client';
import { log } from '../logger';
import { nameScore, NAME_MATCH_THRESHOLD } from '../util/fuzzy';
import { deriveGuestStatus, todayInTyler, addDays, GuestStatus } from '../util/stayStatus';

export { deriveGuestStatus, todayInTyler } from '../util/stayStatus';
export type { GuestStatus } from '../util/stayStatus';

const RESERVATIONS_PATH = '/reservations';

// Everything the agent needs, and nothing it does not.
//
// Note the absence of an email address. The agent is under a hard rule never to
// speak one aloud, and the cheapest way to enforce that is to never put one in its
// context window in the first place.
export interface ReservationSummary {
  reservation_id: string;
  confirmation_code: string | null;
  guest_first_name: string;
  guest_full_name: string;
  suite: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  source: string;
  is_ota: boolean;
  guest_status: GuestStatus;
  has_email_on_file: boolean;
}

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

function isOta(source?: string | null): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return OTA_SOURCES.some((o) => s.includes(o));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(raw: any): ReservationSummary | null {
  const r = raw?.result ?? raw;
  if (!r?._id) return null;

  const fullName: string = r?.guest?.fullName ?? r?.guest?.firstName ?? 'Guest';
  const checkIn: string | null = r?.checkInDateLocalized ?? null;
  const checkOut: string | null = r?.checkOutDateLocalized ?? null;
  const source: string = r?.source ?? 'direct';

  return {
    reservation_id: String(r._id),
    confirmation_code: r?.confirmationCode ?? null,
    guest_first_name: String(fullName).trim().split(/\s+/)[0] || 'Guest',
    guest_full_name: String(fullName),
    suite: r?.listing?.title ?? 'N/A',
    check_in: checkIn,
    check_out: checkOut,
    status: String(r?.status ?? 'unknown'),
    source,
    is_ota: isOta(source),
    guest_status: deriveGuestStatus(checkIn, checkOut),
    has_email_on_file: Boolean(r?.guest?.email),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// VERIFY AGAINST THE LIVE ACCOUNT: Guesty's `fields` param is space-delimited. If
// this comes back empty, drop `fields` and take the fat payload. Eight rooms; the
// response is small either way.
const LIST_FIELDS = [
  '_id',
  'confirmationCode',
  'status',
  'source',
  'checkInDateLocalized',
  'checkOutDateLocalized',
  'guest.fullName',
  'guest.email',
  'listing.title',
].join(' ');

/** Reservations whose check-in falls inside a window. Small by definition. */
async function reservationsBetween(from: string, to: string): Promise<ReservationSummary[]> {
  const filters = JSON.stringify([
    { field: 'checkInDateLocalized', operator: '$gte', value: from },
    { field: 'checkInDateLocalized', operator: '$lte', value: to },
  ]);
  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${RESERVATIONS_PATH}?filters=${encodeURIComponent(filters)}` +
      `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=100&sort=checkInDateLocalized`,
  )) as { results?: unknown[] } | null;

  return (data?.results ?? []).map(shape).filter((r): r is ReservationSummary => r !== null);
}

/**
 * Every reservation currently relevant to a phone call: arriving in the next four
 * months, or departed within the last 45 days. That trailing window is what makes
 * "can you send me a receipt for last week" work at all.
 */
export async function activeReservations(): Promise<ReservationSummary[]> {
  const today = todayInTyler();
  return reservationsBetween(addDays(today, -45), addDays(today, 120));
}

// Same "which stay would they plausibly mean" preference used for phone and email
// lookups: the stay they're ON beats the next one coming, which beats the last one
// that already ended. See BUG FIX note below.
function preferCurrentStay(all: ReservationSummary[]): ReservationSummary | null {
  if (all.length === 0) return null;

  const inHouse = all.find((r) => r.guest_status === 'in_house');
  if (inHouse) return inHouse;

  const upcoming = all
    .filter((r) => r.guest_status === 'upcoming' && r.check_in)
    .sort((a, b) => (a.check_in as string).localeCompare(b.check_in as string));
  if (upcoming.length > 0) return upcoming[0];

  const departed = all
    .filter((r) => r.guest_status === 'departed' && r.check_out)
    .sort((a, b) => (b.check_out as string).localeCompare(a.check_out as string));
  if (departed.length > 0) return departed[0];

  return null;
}

/** Caller ID lookup. Guesty stores phones as digits, so `+1903...` matches nothing. */
// export async function findByPhone(phone: string): Promise<ReservationSummary | null> {
//   const digits = phone.replace(/\D/g, '');
//   if (!digits) return null;

//   const data = (await guestyFetch(
//     'open_api',
//     'GET',
//     `${RESERVATIONS_PATH}?q=${encodeURIComponent(digits)}` +
//       `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=10&sort=-checkInDateLocalized`,
//   )) as { results?: unknown[] } | null;

//   const all = (data?.results ?? []).map(shape).filter((r): r is ReservationSummary => r !== null);

//   // BUG FIX. The old code sorted by `-createdAt` and took the first hit, which is
//   // the reservation most recently CREATED, not the one the guest is calling about.
//   // A guest who booked their August stay back in January, calling from their July
//   // stay, was being read their August dates.
//   return preferCurrentStay(all);
// }

/** Caller ID lookup. Guesty stores phones as digits, so `+1903...` matches nothing. */
export async function findByPhone(phone: string): Promise<ReservationSummary | null> {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;

  // Use Guesty's native filters array
  const filters = JSON.stringify([
    { field: 'guest.phone', operator: '$contains', value: digits }
  ]);

  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${RESERVATIONS_PATH}?filters=${encodeURIComponent(filters)}` +
      `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=10&sort=-checkInDateLocalized`,
  )) as { results?: unknown[] } | null;

  const all = (data?.results ?? []).map(shape).filter((r): r is ReservationSummary => r !== null);

  return preferCurrentStay(all);
}

/** Email lookup, same stay-preference ordering as findByPhone. */
// export async function findByEmail(email: string): Promise<ReservationSummary | null> {
//   const trimmed = email.trim();
//   if (!trimmed) return null;

//   const data = (await guestyFetch(
//     'open_api',
//     'GET',
//     `${RESERVATIONS_PATH}?q=${encodeURIComponent(trimmed)}` +
//       `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=10&sort=-checkInDateLocalized`,
//   )) as { results?: unknown[] } | null;

//   const all = (data?.results ?? []).map(shape).filter((r): r is ReservationSummary => r !== null);
//   return preferCurrentStay(all);
// }

/** Email lookup, same stay-preference ordering as findByPhone. */
export async function findByEmail(email: string): Promise<ReservationSummary | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  // Use Guesty's native filters array
  const filters = JSON.stringify([
    { field: 'guest.email', operator: '$eq', value: trimmed }
  ]);

  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${RESERVATIONS_PATH}?filters=${encodeURIComponent(filters)}` +
      `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=10&sort=-checkInDateLocalized`,
  )) as { results?: unknown[] } | null;

  const all = (data?.results ?? []).map(shape).filter((r): r is ReservationSummary => r !== null);
  return preferCurrentStay(all);
}

// export async function findByConfirmationCode(code: string): Promise<ReservationSummary | null> {
//   const filters = JSON.stringify([
//     { field: 'confirmationCode', operator: '$eq', value: code.trim() },
//   ]);
//   const data = (await guestyFetch(
//     'open_api',
//     'GET',
//     `${RESERVATIONS_PATH}?filters=${encodeURIComponent(filters)}` +
//       `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=1`,
//   )) as { results?: unknown[] } | null;

//   const first = (data?.results ?? [])[0];
//   return first ? shape(first) : null;
// }

// Codes arrive as "GY7FDBUX7F", callers never say "hyphen", and ASR never matches
// Guesty's stored casing (which can be lowercase, e.g. "HA-123abc"). Strip anything
// that is not a letter or digit and uppercase, so both sides compare on equal footing.
// Codes arrive as "GY7FDBUX7F", callers never say "hyphen", and ASR never matches
// Guesty's stored casing (which can be lowercase, e.g. "HA-123abc"). Strip anything
// that is not a letter or digit and uppercase, so both sides compare on equal footing.
export function normalizeCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

// Enumerate every casing of an alphanumeric string. Guesty direct codes are stored
// mixed-case ("GY-7SDbuX7f"), which a caller can't reproduce by voice, so we generate
// all castings and let exact $in match whichever one Guesty holds.
function caseVariants(s: string, cap = 400): string[] {
  const idx: number[] = [];
  [...s].forEach((c, i) => { if (/[a-z]/i.test(c)) idx.push(i); });
  if (2 ** idx.length > cap) return [s.toUpperCase(), s.toLowerCase()]; // pathological, degrade
  const out = new Set<string>();
  for (let mask = 0; mask < 2 ** idx.length; mask++) {
    const ch = s.toUpperCase().split('');
    idx.forEach((p, b) => { if (mask & (1 << b)) ch[p] = ch[p].toLowerCase(); });
    out.add(ch.join(''));
  }
  return [...out];
}

// The exact strings Guesty might hold: the code as one run, and the common "XX-body"
// hyphenated shape (GY-, HA-, HM-), each across all castings. Prefix kept uppercase,
// which is how Guesty stores it.
function codeCandidates(normalized: string): string[] {
  const set = new Set<string>([normalized, normalized.toLowerCase()]);
  if (normalized.length > 3) {
    const prefix = normalized.slice(0, 2);
    for (const body of caseVariants(normalized.slice(2))) set.add(`${prefix}-${body}`);
  }
  return [...set];
}

export async function findByConfirmationCode(code: string): Promise<ReservationSummary | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;

  // Fully format-agnostic: normalizeCode strips case AND every separator on both sides,
  // so we never reconstruct Guesty's punctuation. We only need to fetch candidates.
  const verify = (rows: unknown[] = []): ReservationSummary | null =>
    rows
      .map(shape)
      .filter((r): r is ReservationSummary => r !== null)
      .find((r) => r.confirmation_code && normalizeCode(r.confirmation_code) === normalized) ?? null;

  const byFilter = async (filter: object, limit: number): Promise<unknown[]> => {
    const filters = JSON.stringify([filter]);
    const data = (await guestyFetch(
      'open_api',
      'GET',
      `${RESERVATIONS_PATH}?filters=${encodeURIComponent(filters)}` +
        `&fields=${encodeURIComponent(LIST_FIELDS)}&limit=${limit}`,
    )) as { results?: unknown[] } | null;
    return data?.results ?? [];
  };

  // 1. Exact, no guessing. Uppercase OTA codes, numeric codes, or a code given with the
  //    right punctuation. One request.
  const exactSet = Array.from(new Set([normalized, normalized.toLowerCase(), code.trim()]));
  const exact = verify(await byFilter({ operator: '$in', field: 'confirmationCode', value: exactSet }, 5));
  if (exact) {
    log.info({ normalized, path: 'exact' }, 'confirmation_code_lookup');
    return exact;
  }

  // 2. Case + separator tolerant via case-insensitive $contains. A window that lands
  //    inside any separator-free run matches, regardless of prefix length or hyphen
  //    count. All probes fire together, so it costs one round-trip.
  const windows = (len: number): string[] => {
    const out: string[] = [];
    for (let s = 0; len <= normalized.length && s + len <= normalized.length; s++) {
      out.push(normalized.slice(s, s + len));
    }
    return out;
  };

  for (const len of [4, 3]) {
    const needles = Array.from(new Set(len === 4 ? [normalized, ...windows(4)] : windows(3)));
    const batches = await Promise.all(
      needles.map((n) => byFilter({ operator: '$contains', field: 'confirmationCode', value: n }, 100)),
    );
    const hit = verify(batches.flat());
    if (hit) {
      log.info({ normalized, path: 'contains', window: len, probes: needles.length }, 'confirmation_code_lookup');
      return hit;
    }
  }

  log.info({ normalized, path: 'contains', found: false }, 'confirmation_code_lookup');
  return null;
}

/**
 * Fuzzy match on the name, optionally narrowed by arrival date.
 *
 * This path carries the 30% of bookings that arrive through Expedia (where we never
 * received the guest's real phone number) and every direct guest calling from a
 * different phone.
 *
 * Returns ALL plausible matches. One hit, the agent carries on. Two, the agent asks
 * for a confirmation code, which is the only moment it ever should.
 */
export async function findByNameAndDate(
  guestName: string,
  checkInDate?: string,
): Promise<ReservationSummary[]> {
  const pool = checkInDate
    ? await reservationsBetween(addDays(checkInDate, -3), addDays(checkInDate, 3))
    : await activeReservations();

  const scored = pool
    .map((r) => ({ r, score: nameScore(guestName, r.guest_full_name) }))
    .filter((x) => x.score >= NAME_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  log.info(
    { poolSize: pool.length, hits: scored.length, topScore: scored[0]?.score ?? null },
    'reservation_fuzzy_match',
  );

  return scored.map((x) => x.r);
}

/**
 * Write the caller's real number back onto the guest record once we have identified
 * them some other way.
 *
 * Small thing, compounds hard: every guest we find by name today is a guest we
 * recognise by caller ID tomorrow. The silent-recognition rate climbs on its own and
 * nobody has to do anything.
 */
export async function attachPhoneToGuest(reservationId: string, phone: string): Promise<void> {
  try {
    const raw = (await guestyFetch('open_api', 'GET', `${RESERVATIONS_PATH}/${reservationId}`)) as {
      guest?: { _id?: string; phone?: string };
    } | null;

    const guestId = raw?.guest?._id;
    if (!guestId || raw?.guest?.phone) return; // already has one, leave it alone

    await guestyFetch('open_api', 'PUT', `/guests/${guestId}`, { phone });
    log.info({ reservationId, guestId }, 'guest_phone_backfilled');
  } catch (err) {
    // Never fail a live call over a nice-to-have.
    log.warn({ err, reservationId }, 'guest_phone_backfill_failed');
  }
}
