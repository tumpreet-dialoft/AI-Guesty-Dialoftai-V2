// Pure stay-lifecycle logic. No config, no Guesty client, no credentials.
// Kept separate so it is trivially testable and so a date bug can never take the
// booking flow down with it.

export type GuestStatus = 'upcoming' | 'in_house' | 'departed' | 'none';

/**
 * Today in the hotel's timezone, as YYYY-MM-DD.
 *
 * Never use the server clock. Render runs on UTC and Tyler is on Central, so for six
 * hours out of every day the server thinks it is tomorrow. Get this wrong and a guest
 * is marked `departed` while they are asleep in the building, which means their 2am
 * lockout call gets handled as a receipt request.
 */
export function todayInTyler(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Where the guest is in their stay.
 *
 * The single most consequential field in the system. It decides whether a caller gets
 * asked for a confirmation code, or gets transferred to a human instantly.
 */
export function deriveGuestStatus(
  checkIn?: string | null,
  checkOut?: string | null,
  now: Date = new Date(),
): GuestStatus {
  if (!checkIn || !checkOut) return 'none';
  const today = todayInTyler(now);
  if (today < checkIn) return 'upcoming';
  if (today > checkOut) return 'departed';
  return 'in_house';
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
