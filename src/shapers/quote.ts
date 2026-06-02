import { log } from '../logger';

export interface ShapedQuote {
  quote_id: string;
  suite: string;
  nightly: number;
  nights: number;
  cleaning: number;
  taxes: number;
  total: number;
}

// TODO: Verify field paths against live Guesty quote payload.
// The paths below are illustrative based on typical Guesty Booking Engine quote
// responses. Once you have a real payload, update the property access paths.
// Defensive: if any required field is missing, log a warning and return null.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeQuote(suiteName: string, raw: any): ShapedQuote | null {
  try {
    const quoteId = raw?._id ?? raw?.quoteId ?? raw?.id ?? null;
    const nightly =
      raw?.rates?.basePrice ?? raw?.rates?.nightlyRate ?? raw?.money?.fareAccommodation ?? null;
    const nights = raw?.nights ?? raw?.numberOfNights ?? raw?.stayLength ?? null;
    const cleaning =
      raw?.rates?.cleaningFee ?? raw?.money?.fareCleaning ?? raw?.fees?.cleaning ?? 0;
    const taxes = raw?.rates?.taxes ?? raw?.money?.totalTaxes ?? raw?.taxes?.total ?? 0;
    const total =
      raw?.rates?.total ?? raw?.money?.hostPayout ?? raw?.totalPrice ?? raw?.grandTotal ?? null;

    if (quoteId === null || nightly === null || nights === null || total === null) {
      log.warn(
        {
          suiteName,
          hasQuoteId: quoteId !== null,
          hasNightly: nightly !== null,
          hasNights: nights !== null,
          hasTotal: total !== null,
        },
        'quote_missing_required_fields',
      );
      return null;
    }

    return {
      quote_id: String(quoteId),
      suite: suiteName,
      nightly: Math.round(Number(nightly)),
      nights: Number(nights),
      cleaning: Math.round(Number(cleaning)),
      taxes: Math.round(Number(taxes)),
      total: Math.round(Number(total)),
    };
  } catch (err) {
    log.error({ err, suiteName }, 'quote_shaping_error');
    return null;
  }
}
