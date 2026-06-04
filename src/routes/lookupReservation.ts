import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';
import { lookupReservation } from '../guesty/openApi';
import { extractArgs } from '../util/extractArgs';

const argsSchema = z.object({
  confirmation_code: z.string().min(1, 'confirmation_code is required'),
});

const router = Router();

router.post('/lookup_reservation', async (req: Request, res: Response) => {
  if (!config.ENABLE_V2_LOOKUP) {
    res.status(404).json({ error: 'feature_disabled' });
    return;
  }

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

    const { confirmation_code } = parsed.data;
    const result = await lookupReservation({ confirmationCode: confirmation_code });

    log.info(
      { requestId, route: '/lookup_reservation', durationMs: Date.now() - start, outcome: 'ok' },
      'request_complete',
    );

    res.json(result);
  } catch (err) {
    log.error(
      { err, requestId, route: '/lookup_reservation', durationMs: Date.now() - start },
      'handler_failed',
    );
    res.json({ error: true });
  }
});

export { router as lookupReservationRouter };
