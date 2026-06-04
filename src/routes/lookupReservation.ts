import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';
import { lookupReservation } from '../guesty/openApi';

const schema = z
  .object({
    call: z
      .object({
        call_id: z.string(),
        from_number: z.string(),
      })
      .optional(),
    name: z.string().optional(),
    args: z.object({
      confirmation_code: z.string().min(1, 'confirmation_code is required'),
    }),
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
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      log.warn({ requestId, errors: parsed.error.issues }, 'validation_failed');
      res.status(400).json({ error: true, message: 'Invalid request body' });
      return;
    }

    const { confirmation_code } = parsed.data.args;
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
