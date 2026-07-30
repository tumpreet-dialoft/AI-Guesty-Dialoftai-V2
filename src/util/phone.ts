// The agent is transcribing a number a guest said out loud, so it arrives in
// whatever shape the speech came in: "903 426 8958", "(903) 426-8958", "+1 903...".
// Rejecting anything that is not already E.164 pushes that failure onto the caller,
// who did nothing wrong and cannot fix it.
//
// A wrong number here sends a payment link to a stranger, so this coerces only the
// shapes it can be sure about and returns null for everything else.
const DEFAULT_COUNTRY_CODE = '1'; // Tyler, Texas. Change this and re-read the 10-digit case.

export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) return null;

  // Already international: trust the country code the caller gave.
  if (hadPlus) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }

  // 11 digits starting with 1 is a US number written with its country code.
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  // Bare 10 digits is a US number without one. This is the only assumption made,
  // and it is wrong for an international number typed without a +.
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;

  return null;
}
