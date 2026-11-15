import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { extractArgs } from '../util/extractArgs';
import { inTestMode } from '../util/testMode';
import { nameScore, NAME_MATCH_THRESHOLD } from '../util/fuzzy';
import { addDays, todayInTyler } from '../util/stayStatus';
import { findByConfirmationCode } from '../guesty/reservationSearch';
import { findDoorCode, maskShape } from '../guesty/doorCode';

// Michelle, 9 + 12 Nov 2026: Ava may give a guest their door code once she has verified
// the name, the dates and the confirmation number; if she can't find it or the caller has
// any trouble, transfer to the front desk right away.
//
// The check lives here, not in the prompt. All three must match ONE reservation, and the
// reply never says which one was wrong, so the tool cannot be used to probe for bookings.
// Only stays arriving today or tomorrow, or in house, get a code.

const argsSchema = z.object({
  confirmation_code: z.string().trim().min(3),
  guest_name: z.string().trim().min(2),
  check_in_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/),
});

const TRANSFER = 'Those details do not match a booking we can give a code for. Transfer to the front desk now.';
const LIVE_STATUSES = new Set(['confirmed', 'checked_in', 'checkedin']);

// Many wrong guesses in a short window and every caller is transferred for a while. Cheap
// insurance while the tool endpoint still accepts the shared placeholder secret (AGT-021u).
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 8;
let failures: number[] = [];
function noteFailure(): void {
  const now = Date.now();
  failures = failures.filter((t) => now - t < FAIL_WINDOW_MS);
  failures.push(now);
}
function lockedOut(): boolean {
  const now = Date.now();
  failures = failures.filter((t) => now - t < FAIL_WINDOW_MS);
  return failures.length >= FAIL_LIMIT;
}
/** Tests only. */
export function resetDoorCodeFailures(): void {
  failures = [];
}

const router = Router();

router.post('/get_door_code', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();
  try {
    const raw = extractArgs(req) as Record<string, unknown>;
    const parsed = argsSchema.safeParse(raw);
    if (!parsed.success) {
      res.json({
        ok: false,
        message:
          'Need all three from the caller: the name on the booking, the check-in date (YYYY-MM-DD) and the ' +
          'confirmation number. Ask for what is missing, then call again. If they do not have the confirmation ' +
          'number, transfer to the front desk.',
      });
      return;
    }
    if (lockedOut()) {
      log.warn({ requestId }, 'door_code_locked_out');
      res.json({ ok: false, transfer: true, message: TRANSFER });
      return;
    }

    const { confirmation_code, guest_name } = parsed.data;
    const checkIn = parsed.data.check_in_date.slice(0, 10);
    const r = await findByConfirmationCode(confirmation_code);
    const nameOk = Boolean(r && nameScore(guest_name, r.guest_full_name) >= NAME_MATCH_THRESHOLD);
    const dateOk = Boolean(r && r.check_in === checkIn);
    const statusOk = Boolean(r && LIVE_STATUSES.has(String(r.status).toLowerCase()));
    if (!r || !nameOk || !dateOk || !statusOk) {
      noteFailure();
      log.warn({ requestId, found: Boolean(r), nameOk, dateOk, statusOk }, 'door_code_not_verified');
      res.json({ ok: false, transfer: true, message: TRANSFER });
      return;
    }

    const today = todayInTyler();
    if (r.check_out && today > r.check_out) {
      res.json({ ok: false, transfer: true, message: 'That stay has ended. Transfer to the front desk.' });
      return;
    }
    if (r.check_in && r.check_in > addDays(today, 1)) {
      res.json({
        ok: false,
        not_yet: true,
        message: `Their stay starts ${r.check_in}. The door code comes by email about a day before arrival; nothing to read out yet.`,
      });
      return;
    }

    const found = await findDoorCode(r.reservation_id, { diagnose: inTestMode() });

    // Test mode (simulations, QA, our own checks) never sees a real code: it gets the source
    // and the masked shape, which is all a test needs to prove the path works.
    if (inTestMode()) {
      res.json({
        ok: Boolean(found.best),
        test_mode: true,
        source: found.best?.source ?? null,
        code_shape: found.best ? maskShape(found.best.code) : null,
        candidates: found.candidates.map((c) => ({ source: c.source, label: c.label, shape: maskShape(c.raw), usable: Boolean(c.code) })),
        errors: found.errors,
        diag: found.diag,
        suite: r.suite,
      });
      return;
    }

    if (!found.best?.code) {
      log.warn({ requestId, reservationId: r.reservation_id }, 'door_code_missing');
      res.json({ ok: false, transfer: true, message: 'There is no door code on that booking yet. Transfer to the front desk now.' });
      return;
    }

    const code = found.best.code;
    const spoken = code.split('').map((ch) => (ch === '#' ? 'pound' : ch === '*' ? 'star' : ch)).join(', ');
    log.info({ requestId, reservationId: r.reservation_id, source: found.best.source }, 'door_code_given');
    res.json({
      ok: true,
      door_code: code,
      door_code_spoken: spoken,
      suite: r.suite,
      message: `Door code for ${r.suite}: ${spoken}. Read it slowly, one digit at a time, then offer to repeat it.`,
    });
  } catch (err) {
    log.error({ err, requestId, route: '/get_door_code' }, 'handler_failed');
    res.json({ ok: false, transfer: true, message: 'Could not look up the code. Transfer to the front desk now.' });
  }
});

export { router as getDoorCodeRouter };
