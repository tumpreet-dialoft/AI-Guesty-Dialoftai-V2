import { log } from '../logger';
import { sleep } from '../util/sleep';
import { jitter } from '../util/jitter';
import { findGuestIdByPhone, createGuest } from './guests';
import { createInquiryReservation } from './reservations';
import {
  findConversationByGuestId,
  findConversationByReservationId,
  sendGuestySms,
} from './communication';

// A freshly created inquiry's conversation may not be queryable instantly
// (Guesty advises up to ~60s between reservation mutations). We bound the poll
// so the request stays responsive — if it can't be confirmed, the guest +
// inquiry still exist in Guesty for staff follow-up.
const MAX_CONVERSATION_POLLS = 3;
const POLL_BASE_MS = 400;

async function pollConversationForReservation(reservationId: string): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_CONVERSATION_POLLS; attempt++) {
    const conversationId = await findConversationByReservationId(reservationId);
    if (conversationId) return conversationId;
    if (attempt < MAX_CONVERSATION_POLLS) {
      await sleep(POLL_BASE_MS + jitter(200));
    }
  }
  return null;
}

// Sends the booking-link SMS entirely through Guesty so it threads in the
// Unified Inbox, sent from the Guesty number. Two paths:
//   1. Existing/returning guest -> find their conversation by phone -> send.
//   2. New prospect -> create guest (if needed) + an inquiry reservation ->
//      poll for the spawned conversation -> send.
// Returns true only if a message was actually sent.
export async function sendBookingLinkViaGuesty(params: {
  phone: string;
  guestName: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  body: string;
}): Promise<boolean> {
  const { phone, guestName, listingId, checkIn, checkOut, guests, body } = params;

  // --- Fast path: existing guest already has a conversation ---
  let guestId = await findGuestIdByPhone(phone);
  if (guestId) {
    const conversationId = await findConversationByGuestId(guestId);
    if (conversationId) {
      log.info({ via: 'existing_conversation' }, 'guesty_booking_sms_path');
      return sendGuestySms(conversationId, body);
    }
  }

  // --- New prospect: create what Guesty needs to get a conversation ---
  if (!guestId) {
    guestId = await createGuest({ fullName: guestName, phone });
  }

  const reservationId = await createInquiryReservation({
    listingId,
    checkIn,
    checkOut,
    guests,
    guestId: guestId ?? undefined,
    guest: guestId ? undefined : { fullName: guestName, phone },
  });

  if (!reservationId) {
    log.warn('guesty_booking_sms_no_reservation');
    return false;
  }

  const conversationId = await pollConversationForReservation(reservationId);
  if (!conversationId) {
    log.warn({ reservationId }, 'guesty_booking_sms_no_conversation');
    return false;
  }

  log.info({ via: 'new_inquiry' }, 'guesty_booking_sms_path');
  return sendGuestySms(conversationId, body);
}
