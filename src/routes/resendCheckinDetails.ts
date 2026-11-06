import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { extractArgs } from '../util/extractArgs';
import {
  findByConfirmationCode,
  findByPhone,
  findByEmail,
  findByNameAndDate,
  pickMatch,
  ReservationSummary,
} from '../guesty/reservationSearch';
import {
  findConversationByReservationId,
  sendGuestySms,
  sendGuestyEmail,
} from '../guesty/communication';

const argsSchema = z
  .object({
    confirmation_code: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    // Expedia and Booking.com guests often have no phone on file, so the phone-only
    // resend failed for them (15 of 29 resends in the Nov 2026 review). Name plus
    // arrival date finds them. Still sends ONLY to the contact on the reservation.
    guest_name: z.string().optional(),
    check_in_date: z.string().optional(),
  })
  .refine(
    (d) => Boolean(d.confirmation_code || d.phone || d.email || d.guest_name),
    'Need a confirmation code, phone, email or guest name',
  );

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
    // The caller's own number is on the call record. If the agent passed nothing usable
    // (it did, in simulation, 7 Nov 2026), look them up by caller ID rather than fail.
    const args = { ...extractArgs(req) } as Record<string, unknown>;
    const code = typeof args.confirmation_code === 'string' ? args.confirmation_code.trim() : '';
    if (!code || /^none$|^null$|^unknown$|\{\{/i.test(code)) delete args.confirmation_code;
    const callerId = (req.body?.call as { from_number?: string } | undefined)?.from_number;
    if (!args.confirmation_code && !args.phone && !args.email && !args.guest_name && callerId) {
      args.phone = callerId;
    }
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      res.json({ ok: false, message: 'Need a confirmation code or a phone number.' });
      return;
    }

    const { confirmation_code, phone, email, guest_name, check_in_date } = parsed.data;

    // Same ladder as /lookup_reservation: most certain first.
    let reservation: ReservationSummary | null = confirmation_code
      ? await findByConfirmationCode(confirmation_code)
      : null;
    if (!reservation && phone) reservation = await findByPhone(phone);
    if (!reservation && email) reservation = await findByEmail(email);
    if (!reservation && guest_name) {
      const picked = pickMatch(await findByNameAndDate(guest_name, check_in_date));
      if (picked.ambiguous) {
        res.json({
          ok: false,
          ambiguous: true,
          message: 'More than one booking matches that name. Ask for their check-in date or confirmation code.',
        });
        return;
      }
      reservation = picked.found;
    }

    if (!reservation) {
      res.json({
        ok: false,
        message: guest_name
          ? 'No booking found under that name and date. Transfer to the desk.'
          : 'No booking found with that. Ask for the name on the booking and their check-in date, then try again with guest_name and check_in_date.',
      });
      return;
    }

    if (reservation.guest_status === 'departed') {
      res.json({ ok: false, message: 'That stay has already ended.' });
      return;
    }

    let smsSent = false;
    let emailSent = false;

    // Both channels thread into the existing Guesty conversation so they land in the
    // Unified Inbox and the team can see exactly what the guest was told.
    const conversationId = await findConversationByReservationId(reservation.reservation_id);
    if (conversationId) {
      smsSent = await sendGuestySms(
        conversationId,
        `The Thomas Hotel: here are your arrival details for ${reservation.check_in}. ` +
          `Confirmation: ${reservation.confirmation_code}, Suite: ${reservation.suite}. ` +
          `Any trouble at all, call us on 903-426-8958.`,
      );

      emailSent = await sendGuestyEmail(
        conversationId,
        `Your arrival details — The Thomas Hotel\n\n` +
          `Hello ${reservation.guest_full_name},\n\n` +
          `Here are your arrival details:\n\n` +
          `Confirmation: ${reservation.confirmation_code}\n` +
          `Suite: ${reservation.suite}\n` +
          `Check-in: ${reservation.check_in}\n\n` +
          `Any trouble at all, call us on 903-426-8958.\n\n` +
          `The Thomas Hotel`,
      );
    } else {
      log.warn({ requestId, reservationId: reservation.reservation_id }, 'no_conversation_found');
    }

    log.info(
      { requestId, reservationId: reservation.reservation_id, smsSent, emailSent },
      'checkin_details_resent',
    );

    // ok means something actually went out. It used to be true even when no
    // conversation was found and nothing was sent, and the agent told the guest it
    // was on its way.
    if (!smsSent && !emailSent) {
      res.json({ ok: false, message: 'Found the booking but could not send the details. Transfer to the desk.' });
      return;
    }
    res.json({ ok: true, sent_to_sms: smsSent, sent_to_email: emailSent });
  } catch (err) {
    log.error({ err, requestId, route: '/resend_checkin_details' }, 'handler_failed');
    res.json({ ok: false, message: 'Could not resend the details.' });
  }
});

export { router as resendCheckinDetailsRouter };
