import { Router, Request, Response } from 'express';
import { config } from '../config';
import { log } from '../logger';
import { findByPhone } from '../guesty/reservationSearch';

const router = Router();

/**
 * PRE-CALL LOOKUP. Retell hits this WHILE THE PHONE IS STILL RINGING and injects the
 * response into the agent prompt as dynamic variables.
 *
 * Nobody asked for this endpoint and it is the highest-value one in the system.
 *
 * It is what lets Ava open with "Is that Sarah? I can see you're with us in the Garden
 * Suite" instead of asking a guest standing outside a locked door for a confirmation
 * code. It also routes the call correctly before the caller has said a word.
 *
 * MOUNTED BEFORE retellAuth: Retell does not send x-retell-secret on the inbound
 * webhook (that header only exists on custom function calls). Authenticates on a URL
 * token instead:
 *
 *   https://<host>/retell/inbound?token=<INBOUND_WEBHOOK_TOKEN>
 *
 * SPEED IS THE ENTIRE POINT. You have the ringing time, about a second. An empty
 * answer is a perfectly good answer, because Ava will just identify the caller in
 * conversation. A slow answer is not.
 */
const LOOKUP_BUDGET_MS = 1200;

router.post('/retell/inbound', async (req: Request, res: Response) => {
  const token = req.query.token;
  if (!config.INBOUND_WEBHOOK_TOKEN || token !== config.INBOUND_WEBHOOK_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = req.body as { call_inbound?: { from_number?: string }; from_number?: string };
  const from = body?.call_inbound?.from_number ?? body?.from_number;

  const empty = { dynamic_variables: { guest_status: 'none' } };

  if (!from) {
    res.json(empty);
    return;
  }

  try {
    const reservation = await Promise.race([
      findByPhone(from),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_BUDGET_MS)),
    ]);

    if (!reservation) {
      log.info({ from }, 'inbound_lookup_no_match');
      res.json(empty);
      return;
    }

    log.info(
      { from, guestStatus: reservation.guest_status, source: reservation.source },
      'inbound_lookup_matched',
    );

    // Note what is NOT here: the email address. The agent must never speak one aloud,
    // and the surest way to guarantee that is to never hand it one.
    res.json({
      dynamic_variables: {
        guest_status: reservation.guest_status,
        guest_name: reservation.guest_first_name,
        suite: reservation.suite,
        check_in: reservation.check_in ?? '',
        check_out: reservation.check_out ?? '',
        confirmation_code: reservation.confirmation_code ?? '',
        booking_source: reservation.is_ota ? reservation.source.toLowerCase() : 'direct',
      },
    });
  } catch (err) {
    // Never fail an inbound call over a lookup. Ava copes fine without it.
    log.error({ err, from }, 'inbound_lookup_failed');
    res.json(empty);
  }
});

export { router as inboundLookupRouter };
