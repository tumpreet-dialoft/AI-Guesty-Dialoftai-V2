import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { validateDateRange } from '../util/dates';
import { resolveListingId } from '../listings/map';
import { buildBookingLink } from '../links/bookingLink';
import { sendSms } from '../twilio/sms';
import { extractArgs } from '../util/extractArgs';

const E164_RE = /^\+[1-9]\d{1,14}$/;

const argsSchema = z.object({
  suite_name: z.string(),
  check_in_date: z.string(),
  check_out_date: z.string(),
  number_of_guests: z.coerce.number().int().min(1).max(10),
  phone_number: z.string().regex(E164_RE, 'phone_number must be E.164 format'),
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

    const { suite_name, check_in_date, check_out_date, number_of_guests, phone_number } =
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
    const sent = await sendSms(phone_number, body);

    log.info(
      {
        requestId,
        route: '/send_booking_link',
        durationMs: Date.now() - start,
        outcome: sent ? 'ok' : 'sms_failed',
      },
      'request_complete',
    );

    res.json({ sent });
  } catch (err) {
    log.error(
      { err, requestId, route: '/send_booking_link', durationMs: Date.now() - start },
      'handler_failed',
    );
    res.json({ sent: false });
  }
});

export { router as sendBookingLinkRouter };
