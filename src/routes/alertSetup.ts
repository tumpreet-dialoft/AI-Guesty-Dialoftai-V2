import { Router, Request, Response } from 'express';
import { config } from '../config';
import { log } from '../logger';
import { LISTING_MAP } from '../listings/map';
import { createGuest } from '../guesty/guests';
import { createInquiryReservation } from '../guesty/reservations';
import { findConversationByReservationId, sendGuestySms } from '../guesty/communication';
import { sleep } from '../util/sleep';
import { alertConversations } from '../alerts/staffAlert';

// One-time setup for the Guesty alert channel (15 Nov 2026, Kavish: "go with Guesty").
// Guesty only texts inside a conversation, and a conversation needs a guest plus a reservation,
// so this creates a dedicated contact "Ava Alerts - Front Desk" with the desk phone and one
// INQUIRY (an inquiry blocks no dates and triggers none of the hotel's automations; checked on
// GY-d3nWp5iQ). Always a NEW guest record, never one found by phone: the desk number may sit on
// real guests' bookings, and alerts must never land in a guest's thread.
// The returned conversation id goes into GUESTY_ALERT_CONVERSATION_ID. Behind the tool secret.

const router = Router();

router.post('/ops/setup_alert_conversation', async (req: Request, res: Response) => {
  if (config.GUESTY_ALERT_CONVERSATION_ID && req.body?.force !== true) {
    res.json({ ok: true, existing: true, conversation_id: config.GUESTY_ALERT_CONVERSATION_ID });
    return;
  }
  const phone = String(req.body?.phone ?? config.STAFF_DESK_SMS_NUMBER);
  const fullName = String(req.body?.full_name ?? 'Ava Alerts - Front Desk');
  const listingId = String(req.body?.listing_id ?? Object.values(LISTING_MAP)[0] ?? '');
  const checkIn = String(req.body?.check_in ?? '2027-06-01');
  const checkOut = String(req.body?.check_out ?? '2027-06-02');
  try {
    const guestId = await createGuest({ fullName, phone });
    if (!guestId) {
      res.json({ ok: false, step: 'create_guest' });
      return;
    }
    const reservationId = await createInquiryReservation({ listingId, checkIn, checkOut, guests: 1, guestId });
    if (!reservationId) {
      res.json({ ok: false, step: 'create_inquiry', guest_id: guestId });
      return;
    }
    let conversationId: string | null = null;
    for (let i = 0; i < 15 && !conversationId; i++) {
      conversationId = await findConversationByReservationId(reservationId);
      if (!conversationId) await sleep(2000);
    }
    log.info({ guestId, reservationId, conversationId }, 'alert_conversation_created');
    res.json({ ok: Boolean(conversationId), guest_id: guestId, reservation_id: reservationId, conversation_id: conversationId });
  } catch (err) {
    log.error({ err }, 'alert_conversation_setup_failed');
    res.json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 160) });
  }
});

// Sends one text through the configured alert conversation, nothing else (no Twilio, no webhook).
router.post('/ops/alert_channel_check', async (req: Request, res: Response) => {
  const convs = alertConversations();
  if (!convs.length) {
    res.json({ ok: false, message: 'GUESTY_ALERT_CONVERSATION_ID is not set' });
    return;
  }
  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    res.json({ ok: false, message: 'text required' });
    return;
  }
  const only = String(req.body?.only ?? '').trim();
  const targets = only ? convs.filter((c) => c.endsWith(only)) : convs;
  const results = [];
  for (const c of targets) results.push({ conversation: `…${c.slice(-4)}`, ok: await sendGuestySms(c, text.slice(0, 480)) });
  res.json({ ok: results.length > 0 && results.every((r) => r.ok), results });
});

export { router as alertSetupRouter };
