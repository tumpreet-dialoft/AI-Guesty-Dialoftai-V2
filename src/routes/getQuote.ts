import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { validateDateRange } from '../util/dates';
import { resolveListingId } from '../listings/map';
import { getQuote } from '../guesty/bookingEngine';
import { extractArgs } from '../util/extractArgs';

const argsSchema = z.object({
  suite_name: z.string(),
  check_in_date: z.string(),
  check_out_date: z.string(),
  number_of_guests: z.coerce.number().int().min(1).max(10),
});

const router = Router();

router.post('/get_quote', async (req: Request, res: Response) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

  try {
    const raw = extractArgs(req);
    const parsed = argsSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ requestId, errors: parsed.error.issues }, 'validation_failed');
      res.status(400).json({ error: true, message: 'Invalid request body' });
      return;
    }

    const { suite_name, check_in_date, check_out_date, number_of_guests } = parsed.data;

    const listingId = resolveListingId(suite_name);
    if (!listingId) {
      log.warn({ requestId, suite_name }, 'unknown_suite_name');
      res.json({ error: true });
      return;
    }

    const dateCheck = validateDateRange(check_in_date, check_out_date);
    if (!dateCheck.ok) {
      log.warn({ requestId, reason: dateCheck.reason }, 'date_validation_failed');
      res.json({ error: true });
      return;
    }

    const shaped = await getQuote(listingId, suite_name, check_in_date, check_out_date, number_of_guests);

    if (!shaped) {
      log.warn({ requestId }, 'quote_shaping_returned_null');
      res.json({ error: true });
      return;
    }

    log.info(
      { requestId, route: '/get_quote', durationMs: Date.now() - start, outcome: 'ok' },
      'request_complete',
    );

    res.json(shaped);
  } catch (err) {
    log.error(
      { err, requestId, route: '/get_quote', durationMs: Date.now() - start },
      'handler_failed',
    );
    res.json({ error: true });
  }
});

export { router as getQuoteRouter };
