import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { validateDateRange } from '../util/dates';
import { checkAvailability } from '../guesty/bookingEngine';
import { extractArgs } from '../util/extractArgs';

const argsSchema = z.object({
  check_in_date: z.string(),
  check_out_date: z.string(),
  number_of_guests: z.coerce.number().int().min(1).max(10),
});

const router = Router();

router.post('/check_availability', async (req: Request, res: Response) => {
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

    const { check_in_date, check_out_date, number_of_guests } = parsed.data;

    const dateCheck = validateDateRange(check_in_date, check_out_date);
    if (!dateCheck.ok) {
      log.warn({ requestId, reason: dateCheck.reason }, 'date_validation_failed');
      res.json({ error: true });
      return;
    }

    const result = await checkAvailability(check_in_date, check_out_date, number_of_guests);

    log.info(
      { requestId, route: '/check_availability', durationMs: Date.now() - start, outcome: 'ok' },
      'request_complete',
    );

    res.json(result);
  } catch (err) {
    log.error(
      { err, requestId, route: '/check_availability', durationMs: Date.now() - start },
      'handler_failed',
    );
    res.json({ error: true });
  }
});

export { router as checkAvailabilityRouter };
