import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';
import {
  findByConfirmationCode,
  findByNameAndDate,
  findByPhone,
  findByEmail,
  attachPhoneToGuest,
} from '../guesty/reservationSearch';
import { extractArgs } from '../util/extractArgs';

const argsSchema = z
  .object({
    confirmation_code: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    guest_name: z.string().optional(),
    // Narrows the fuzzy name match. Nobody remembers their confirmation code, but
    // everybody knows their own name and roughly when they are arriving.
    check_in_date: z.string().optional(),
  })
  .refine(
    (d) => Boolean(d.confirmation_code || d.email || d.phone || d.guest_name),
    'At least one of confirmation_code, email, phone, or guest_name is required',
  );

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

    const { confirmation_code, email, phone, guest_name, check_in_date } = parsed.data;

    // The ladder, cheapest and most certain first.
    //   1. confirmation code  - exact, unique
    //   2. caller ID          - silent, zero friction, covers most direct bookings
    //   3. email              - covers callers who only have their booking email
    //   4. name + dates       - fuzzy, covers OTA guests and anyone on a borrowed phone
    let found = confirmation_code ? await findByConfirmationCode(confirmation_code) : null;

    if (!found && phone) {
      found = await findByPhone(phone);
    }

    if (!found && email) {
      found = await findByEmail(email);
    }

    if (!found && guest_name) {
      const matches = await findByNameAndDate(guest_name, check_in_date);

      if (matches.length > 1) {
        // Two people with the same name that week. THIS is the moment to ask for a
        // confirmation code, and the only one.
        log.info({ requestId, matches: matches.length }, 'lookup_ambiguous');
        res.json({
          found: false,
          ambiguous: true,
          matches: matches.length,
          message: 'More than one booking matches that name. Ask for a confirmation code.',
        });
        return;
      }

      found = matches[0] ?? null;

      // Identified by name from an unrecognised number. Backfill it so caller ID
      // works next time. Small thing, compounds: the silent-recognition rate climbs
      // on its own and nobody has to do anything.
      if (found && phone) {
        void attachPhoneToGuest(found.reservation_id, phone);
      }
    }

    log.info(
      {
        requestId,
        route: '/lookup_reservation',
        durationMs: Date.now() - start,
        outcome: found ? 'found' : 'not_found',
        guestStatus: found?.guest_status,
      },
      'request_complete',
    );

    if (!found) {
      res.json({ found: false });
      return;
    }

    res.json({ found: true, ...found });
  } catch (err) {
    log.error(
      { err, requestId, route: '/lookup_reservation', durationMs: Date.now() - start },
      'handler_failed',
    );
    res.json({ error: true });
  }
});

export { router as lookupReservationRouter };
