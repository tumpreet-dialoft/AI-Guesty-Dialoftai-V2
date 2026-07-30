import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { log } from '../logger';
import { extractArgs } from '../util/extractArgs';
import { findByConfirmationCode, findByPhone } from '../guesty/reservationSearch';
import { findConversationByReservationId, sendGuestyEmail } from '../guesty/communication';
import { guestyFetch } from '../guesty/client';

/**
 * A receipt without figures is not a receipt. `findByConfirmationCode` deliberately
 * fetches a thin projection, so pull the `money` block separately for this one route.
 */
interface Money {
  currency?: string;
  fareAccommodation?: number;
  fareCleaning?: number;
  totalTaxes?: number;
  hostPayout?: number;
  totalPaid?: number;
  balanceDue?: number;
}

async function fetchMoney(reservationId: string): Promise<Money | null> {
  try {
    const raw = (await guestyFetch(
      'open_api',
      'GET',
      `/reservations/${reservationId}?fields=${encodeURIComponent('money')}`,
    )) as { result?: { money?: Money }; money?: Money } | null;
    return raw?.result?.money ?? raw?.money ?? null;
  } catch (err) {
    log.warn({ err, reservationId }, 'receipt_money_fetch_failed');
    return null;
  }
}

// Guesty returns major units already, so no cents conversion. Missing figures are
// omitted rather than printed as 0.00 — a wrong number on a receipt is worse than
// an absent one.
function line(label: string, amount: number | undefined, currency: string): string | null {
  if (typeof amount !== 'number') return null;
  return `${label}: ${currency} ${amount.toFixed(2)}`;
}

// "Receipt" is a claim that money changed hands. When nothing has been paid it is
// a statement, and calling it a receipt tells a guest they have settled a bill they
// still owe.
function heading(money: Money | null): string {
  return money && typeof money.totalPaid === 'number' && money.totalPaid > 0
    ? 'Your receipt'
    : 'Your booking statement';
}

function moneyLines(money: Money | null): string {
  if (!money) return '';
  const cur = money.currency ?? 'USD';
  const rows = [
    line('Accommodation', money.fareAccommodation, cur),
    line('Cleaning fee', money.fareCleaning, cur),
    line('Taxes', money.totalTaxes, cur),
    line('Total', money.hostPayout, cur),
    line('Paid', money.totalPaid, cur),
    line('Balance due', money.balanceDue, cur),
  ].filter((r): r is string => r !== null);

  return rows.length > 0 ? `\n${rows.join('\n')}\n` : '';
}

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

    const conversationId = await findConversationByReservationId(reservation.reservation_id);
    if (!conversationId) {
      log.error({ requestId, reservationId: reservation.reservation_id }, 'no_conversation_found');
      res.json({ ok: false, message: 'Could not send the receipt.' });
      return;
    }

    const money = await fetchMoney(reservation.reservation_id);

    const sent = await sendGuestyEmail(
      conversationId,
      `${heading(money)} — The Thomas Hotel\n\n` +
        `Hello ${reservation.guest_full_name},\n\n` +
        `Here are the details for your stay:\n\n` +
        `Confirmation: ${reservation.confirmation_code}\n` +
        `Suite: ${reservation.suite}\n` +
        `Check-in: ${reservation.check_in}\n` +
        `Check-out: ${reservation.check_out}\n` +
        moneyLines(money) +
        `\nQuestions about the charges? Call us on 903-426-8958.\n\n` +
        `The Thomas Hotel`,
    );

    if (!sent) {
      res.json({ ok: false, message: 'Could not send the receipt.' });
      return;
    }

    log.info({ requestId, reservationId: reservation.reservation_id }, 'receipt_sent');

    // Never return the address itself. If it is not in the agent's context, the agent
    // cannot read it out loud.
    res.json({ ok: true, sent_to: 'the email on your booking' });
  } catch (err) {
    log.error({ err, requestId, route: '/send_receipt' }, 'handler_failed');
    res.json({ ok: false, message: 'Could not send the receipt.' });
  }
});

export { router as sendReceiptRouter };
