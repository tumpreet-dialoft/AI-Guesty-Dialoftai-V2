import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';
import { validateDateRange } from '../util/dates';
import { resolveListingId } from '../listings/map';
import { buildBookingLink } from '../links/bookingLink';
import { sendSms } from '../twilio/sms';
import { sendBookingLinkViaGuesty } from '../guesty/bookingSms';
import { extractArgs } from '../util/extractArgs';

const E164_RE = /^\+[1-9]\d{1,14}$/;

const argsSchema = z.object({
  suite_name: z.string(),
  check_in_date: z.string(),
  check_out_date: z.string(),
  number_of_guests: z.coerce.number().int().min(1).max(10),
  phone_number: z.string().regex(E164_RE, 'phone_number must be E.164 format'),
  guest_name: z.string().optional(),
});

const router = Router();

router.post('/send_booking_link', async (req: Request, res: Response) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

  try {
    const raw = extractArgs(req);
    const parsed = argsSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ requestId, errors: parsed.error.issues }, 'validation_failed');
      res.status(400).json({ sent: false, message: 'Invalid request body' });
      return;
    }

    const { suite_name, check_in_date, check_out_date, number_of_guests, phone_number, guest_name } =
      parsed.data;

    const listingId = resolveListingId(suite_name);
    if (!listingId) {
      log.warn({ requestId, suite_name }, 'unknown_suite_name');
      res.json({ sent: false });
      return;
    }

    const dateCheck = validateDateRange(check_in_date, check_out_date);
    if (!dateCheck.ok) {
      log.warn({ requestId, reason: dateCheck.reason }, 'date_validation_failed');
      res.json({ sent: false });
      return;
    }

    const link = buildBookingLink(suite_name, check_in_date, check_out_date, number_of_guests);
    const body = `The Thomas Hotel: finish your booking & payment here: ${link}`;

    // When ENABLE_GUESTY_SMS is on, deliver through Guesty so the message
    // threads in the Unified Inbox (sent from the Guesty number). Otherwise keep
    // the original Twilio path unchanged.
    const sent = config.ENABLE_GUESTY_SMS
      ? await sendBookingLinkViaGuesty({
          phone: phone_number,
          guestName: guest_name?.trim() || 'Guest',
          listingId,
          checkIn: check_in_date,
          checkOut: check_out_date,
          guests: number_of_guests,
          body,
        })
      : await sendSms(phone_number, body);

    // BUG FIX. This used to return only { sent: boolean }.
    //
    // In the June demo Ava said the link had gone to the number "ending in 9964",
    // then thirty seconds later said "ending in 9954". She invented both. Handed no
    // digits, an LLM confabulates rather than staying quiet, and a guest who hears
    // the wrong four digits assumes the text went to a stranger.
    //
    // Give her the digits and the prompt's rule ("read back only what the tool
    // returned") becomes enforceable instead of aspirational.
    const last4 = phone_number.replace(/\D/g, '').slice(-4);

    log.info(
      {
        requestId,
        route: '/send_booking_link',
        durationMs: Date.now() - start,
        outcome: sent ? 'ok' : 'sms_failed',
      },
      'request_complete',
    );

    // NOTE: `sent` is true the moment Twilio ACCEPTS the message. That is not the
    // same as a carrier DELIVERING it. If the number is not A2P 10DLC registered,
    // US carriers filter these silently, Twilio still returns a SID, and Ava still
    // says "on its way". Verify the registration; this failure leaves no trace.
    res.json({
      sent,
      sent_to_last4: sent ? last4 : null,
      message: sent
        ? `Booking link texted to the number ending ${last4}.`
        : 'The text could not be sent.',
    });
  } catch (err) {
    log.error(
      { err, requestId, route: '/send_booking_link', durationMs: Date.now() - start },
      'handler_failed',
    );
    res.json({ sent: false });
  }
});

export { router as sendBookingLinkRouter };
