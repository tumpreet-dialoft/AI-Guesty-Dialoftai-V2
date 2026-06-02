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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeQuote(suiteName: string, raw: any): ShapedQuote | null {
  try {
    if (!raw) {
      log.warn({ suiteName }, 'quote_raw_is_null');
      return null;
    }

    const quoteId = raw._id ?? null;
    const ratePlan = raw.rates?.ratePlans?.[0]?.ratePlan ?? raw.rates?.ratePlans?.[0];
    const money = ratePlan?.money;
    const days = ratePlan?.days;

    if (!money) {
      log.warn({ suiteName, hasRates: !!raw.rates }, 'quote_missing_money_block');
      return null;
    }

    const fareAccommodation = money.fareAccommodation ?? null;
    const fareCleaning = money.fareCleaning ?? 0;
    const totalTaxes = money.totalTaxes ?? 0;
    const hostPayout = money.hostPayout ?? null;

    let nights: number | null = null;
    if (Array.isArray(days) && days.length > 0) {
      nights = days.length;
    } else if (raw.checkInDateLocalized && raw.checkOutDateLocalized) {
      const ci = new Date(raw.checkInDateLocalized);
      const co = new Date(raw.checkOutDateLocalized);
      nights = Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (quoteId === null || fareAccommodation === null || nights === null || hostPayout === null) {
      log.warn(
        {
          suiteName,
          hasQuoteId: quoteId !== null,
          hasFare: fareAccommodation !== null,
          hasNights: nights !== null,
          hasTotal: hostPayout !== null,
        },
        'quote_missing_required_fields',
      );
      return null;
    }

    const avgNightly = fareAccommodation / nights;

    return {
      quote_id: String(quoteId),
      suite: suiteName,
      nightly: Math.round(avgNightly),
      nights,
      cleaning: Math.round(fareCleaning),
      taxes: Math.round(totalTaxes),
      total: Math.round(hostPayout),
    };
  } catch (err) {
    log.error({ err, suiteName }, 'quote_shaping_error');
    return null;
  }
}
