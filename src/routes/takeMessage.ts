import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { extractArgs } from '../util/extractArgs';
import { raiseStaffAlert } from '../alerts/staffAlert';

const E164_RE = /^\+[1-9]\d{1,14}$/;

const argsSchema = z.object({
  caller_name: z.string().min(1),
  callback_number: z.string().regex(E164_RE, 'callback_number must be E.164'),
  reason: z.string().min(1),
  details: z.string().default(''),
  priority: z.enum(['urgent', 'high', 'normal']).default('normal'),
});

const router = Router();

/**
 * THE FLOOR UNDER EVERY OTHER FLOW.
 *
 * The agent is instructed never to promise a callback without calling this. So if
 * this endpoint silently no-ops, Ava tells guests someone is ringing them back and
 * nobody ever does. That is strictly worse than the missed call this whole system
 * was built to fix, because now the guest has stopped worrying about it.
 *
 * It fires AFTER a transfer has already gone unanswered. Given the client's actual
 * problem, roughly 84 missed calls a month, that is not a rare edge case.
 */
router.post('/take_message', async (req: Request, res: Response) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

  try {
    const parsed = argsSchema.safeParse(extractArgs(req));
    if (!parsed.success) {
      // A malformed message is still a guest waiting for a call. Be loud.
      log.error(
        { requestId, errors: parsed.error.issues },
        'TAKE_MESSAGE_MALFORMED_BUT_GUEST_IS_WAITING',
      );
      res.json({ ok: false, message: 'Could not record the message.' });
      return;
    }

    const { notified } = await raiseStaffAlert(parsed.data);

    log.info(
      {
        requestId,
        route: '/take_message',
        priority: parsed.data.priority,
        notified,
        durationMs: Date.now() - start,
      },
      'request_complete',
    );

    res.json({ ok: notified.length > 0, notified });
  } catch (err) {
    log.error({ err, requestId, route: '/take_message' }, 'handler_failed');
    res.json({ ok: false, message: 'Could not record the message.' });
  }
});

export { router as takeMessageRouter };
