import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';
import { extractArgs } from '../util/extractArgs';
import { findByConfirmationCode, findByPhone } from '../guesty/reservationSearch';

const argsSchema = z
  .object({
    confirmation_code: z.string().optional(),
    phone: z.string().optional(),
    email_override: z.string().email().optional(),
  })
  .refine((d) => Boolean(d.confirmation_code || d.phone), 'Need a confirmation code or a phone');

const router = Router();

/**
 * The single most common call Andrew gets from a departed guest. He said so himself
 * on the June call: people ring after checkout wanting a receipt emailed. There was
 * no path for it at all.
 *
 * DELIVERY: Guesty exposes no public "email the folio" endpoint, so this resolves the
 * reservation and hands the send to n8n, which already has a Gmail connector wired.
 * n8n fires within seconds of the call ending.
 *
 * Which is exactly why the agent is scripted to say "I'll get that sent over" in the
 * future tense, and never "I've sent it". At the moment it speaks, we haven't.
 */
router.post('/send_receipt', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

  try {
    const parsed = argsSchema.safeParse(extractArgs(req));
    if (!parsed.success) {
      res.json({ ok: false, message: 'Need a confirmation code or a phone number.' });
      return;
    }

    const { confirmation_code, phone, email_override } = parsed.data;

    const reservation = confirmation_code
      ? await findByConfirmationCode(confirmation_code)
      : await findByPhone(phone as string);

    if (!reservation) {
      res.json({ ok: false, message: 'No reservation found.' });
      return;
    }

    if (!reservation.has_email_on_file && !email_override) {
      res.json({ ok: false, message: 'No email address on this booking.' });
      return;
    }

    if (email_override) {
      // The agent only fills this in after reading the address back to the caller.
      // Log it regardless: a folio going somewhere new deserves an audit row.
      log.warn(
        { requestId, reservationId: reservation.reservation_id },
        'receipt_sent_to_override_address',
      );
    }

    if (!config.RECEIPT_WEBHOOK_URL) {
      log.error({ requestId }, 'RECEIPT_WEBHOOK_URL not set, receipt cannot be delivered');
      res.json({ ok: false, message: 'Receipt system unavailable.' });
      return;
    }

    await fetch(config.RECEIPT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'receipt',
        reservation_id: reservation.reservation_id,
        confirmation_code: reservation.confirmation_code,
        guest_name: reservation.guest_full_name,
        suite: reservation.suite,
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        email_override: email_override ?? null,
      }),
    });

    log.info({ requestId, reservationId: reservation.reservation_id }, 'receipt_queued');

    // Never return the address itself. If it is not in the agent's context, the agent
    // cannot read it out loud.
    res.json({ ok: true, sent_to: 'the email on your booking' });
  } catch (err) {
    log.error({ err, requestId, route: '/send_receipt' }, 'handler_failed');
    res.json({ ok: false, message: 'Could not send the receipt.' });
  }
});

export { router as sendReceiptRouter };
