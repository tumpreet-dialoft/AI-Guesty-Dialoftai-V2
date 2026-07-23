import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';
import { extractArgs } from '../util/extractArgs';
import { findByConfirmationCode, findByPhone } from '../guesty/reservationSearch';
import { findConversationByReservationId, sendGuestySms } from '../guesty/communication';

const argsSchema = z
  .object({
    confirmation_code: z.string().optional(),
    phone: z.string().optional(),
  })
  .refine((d) => Boolean(d.confirmation_code || d.phone), 'Need a confirmation code or a phone');

const router = Router();

/**
 * Re-send the arrival email and door code. Common: the guest is at the door and
 * cannot find the email Guesty sent them 24 hours ago.
 *
 * SECURITY: THIS ENDPOINT TAKES NO DESTINATION PARAMETER. Deliberately.
 *
 * It sends only to the contact already on the reservation. There is no override and
 * there must never be one. The prompt also tells Ava to transfer anyone asking for a
 * door code at a NEW address, but a prompt rule is a suggestion and this is a wall.
 * Nobody should be able to talk a door code out of an AI by knowing a guest's name
 * and their dates.
 */
router.post('/resend_checkin_details', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

  try {
    const parsed = argsSchema.safeParse(extractArgs(req));
    if (!parsed.success) {
      res.json({ ok: false, message: 'Need a confirmation code or a phone number.' });
      return;
    }

    const { confirmation_code, phone } = parsed.data;

    const reservation = confirmation_code
      ? await findByConfirmationCode(confirmation_code)
      : await findByPhone(phone as string);

    if (!reservation) {
      res.json({ ok: false, message: 'No reservation found.' });
      return;
    }

    if (reservation.guest_status === 'departed') {
      res.json({ ok: false, message: 'That stay has already ended.' });
      return;
    }

    let smsSent = false;

    // Preferred: thread it into the existing Guesty conversation so it lands in the
    // Unified Inbox and the team can see exactly what the guest was told.
    const conversationId = await findConversationByReservationId(reservation.reservation_id);
    if (conversationId) {
      smsSent = await sendGuestySms(
        conversationId,
        `The Thomas Hotel: here are your arrival details for ${reservation.check_in}. ` +
          `Confirmation: ${reservation.confirmation_code}, Suite: ${reservation.suite}. ` +
          `Any trouble at all, call us on 903-426-8958.`,
      );
    }

    // Guesty has no public endpoint to re-fire the pre-arrival email, so n8n owns it.
    let emailSent = false;
    if (config.RECEIPT_WEBHOOK_URL) {
      try {
        const webhookRes = await fetch(config.RECEIPT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'checkin_details',
            reservation_id: reservation.reservation_id,
            confirmation_code: reservation.confirmation_code,
            guest_name: reservation.guest_full_name,
            suite: reservation.suite,
            check_in: reservation.check_in,
          }),
        });
        emailSent = webhookRes.ok;
      } catch (err) {
        log.error({ err, requestId }, 'checkin_resend_webhook_failed');
      }
    } else {
      log.error({ requestId }, 'RECEIPT_WEBHOOK_URL not set, checkin details email not sent');
    }

    log.info(
      { requestId, reservationId: reservation.reservation_id, smsSent, emailSent },
      'checkin_details_resent',
    );

    res.json({ ok: true, sent_to_sms: smsSent, sent_to_email: emailSent });
  } catch (err) {
    log.error({ err, requestId, route: '/resend_checkin_details' }, 'handler_failed');
    res.json({ ok: false, message: 'Could not resend the details.' });
  }
});

export { router as resendCheckinDetailsRouter };
