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

export function validateDateRange(
  checkin: string,
  checkout: string,
): { ok: true } | { ok: false; reason: string } {
  if (!isValidIsoDate(checkin)) return { ok: false, reason: 'Invalid check_in_date format' };
  if (!isValidIsoDate(checkout)) return { ok: false, reason: 'Invalid check_out_date format' };
  if (!isNotInPast(checkin)) return { ok: false, reason: 'check_in_date is in the past' };
  if (!isCheckoutAfterCheckin(checkin, checkout))
    return { ok: false, reason: 'check_out_date must be after check_in_date' };
  return { ok: true };
}
