const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayChicago(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = s.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

export function isNotInPast(dateStr: string): boolean {
  return dateStr >= todayChicago();
}

export function isCheckoutAfterCheckin(checkin: string, checkout: string): boolean {
  return checkout > checkin;
}

/**
 * `guestMessage` exists because a bad date and a dead upstream used to be the same
 * `{ error: true }` to the agent, so Ava transferred a caller to a human over a
 * February 29th that simply does not exist in that year. She can only say something
 * useful if the failure tells her what was wrong with it.
 */
export function validateDateRange(
  checkin: string,
  checkout: string,
): { ok: true } | { ok: false; reason: string; guestMessage: string } {
  const NOT_A_DATE = 'That is not a date on the calendar. Please confirm the day, month and year.';

  if (!isValidIsoDate(checkin))
    return { ok: false, reason: 'Invalid check_in_date format', guestMessage: NOT_A_DATE };
  if (!isValidIsoDate(checkout))
    return { ok: false, reason: 'Invalid check_out_date format', guestMessage: NOT_A_DATE };
  if (!isNotInPast(checkin))
    return {
      ok: false,
      reason: 'check_in_date is in the past',
      guestMessage: 'That date has already passed. Please confirm the dates.',
    };
  if (!isCheckoutAfterCheckin(checkin, checkout))
    return {
      ok: false,
      reason: 'check_out_date must be after check_in_date',
      guestMessage: 'The check-out date must be after the check-in date.',
    };
  return { ok: true };
}
