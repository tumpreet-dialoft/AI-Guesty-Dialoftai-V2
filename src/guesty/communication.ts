import { guestyFetch } from './client';
import { log } from '../logger';

// Guesty Open API base URL already includes /v1 (config.GUESTY_OAPI_BASE_URL),
// so communication paths are relative to it.
const CONVERSATIONS_PATH = '/communication/conversations';

// The `module` selects the channel the Unified Inbox sends through. Verified
// against the live account: `module` is an OBJECT and SMS is `{ type: 'sms' }`.
// Guesty sends from the account's provisioned SMS number, so the message threads
// in the dashboard.
const SMS_MODULE = { type: 'sms' };

// Same shape, different channel. Guesty rejects a `subject` field on this endpoint
// (VALIDATION_ERROR), so the first line of `body` is all the subject we get.
const EMAIL_MODULE = { type: 'email' };

// Conversation list responses are wrapped: { status, data: { conversations } }.
interface ConversationSearchResponse {
  data?: {
    conversations?: { _id: string }[];
  };
}

// Returns the newest conversation _id whose field == value, or null. Uses the
// `filters` JSON param (the only supported filter form — bare `guest._id=` /
// `reservation._id=` query params are rejected with a validation error).
async function searchConversationId(field: string, value: string): Promise<string | null> {
  const filters = JSON.stringify([{ field, operator: '$eq', value }]);
  const data = (await guestyFetch(
    'open_api',
    'GET',
    `${CONVERSATIONS_PATH}?filters=${encodeURIComponent(filters)}&fields=_id&limit=1&sort=-lastUpdateAt`,
  )) as ConversationSearchResponse | null;
  return data?.data?.conversations?.[0]?._id ?? null;
}

export async function findConversationByGuestId(guestId: string): Promise<string | null> {
  return searchConversationId('guest._id', guestId);
}

export async function findConversationByReservationId(
  reservationId: string,
): Promise<string | null> {
  return searchConversationId('reservation._id', reservationId);
}

// Sends into an existing conversation via the Unified Inbox. Mirrors the boolean
// contract of src/twilio/sms.ts so callers stay uniform.
async function send(
  conversationId: string,
  module: { type: string },
  body: string,
): Promise<boolean> {
  try {
    await guestyFetch(
      'open_api',
      'POST',
      `${CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}/send-message`,
      { module, body },
    );
    log.info({ conversationId, channel: module.type }, 'guesty_message_sent');
    return true;
  } catch (err) {
    log.error({ err, conversationId, channel: module.type }, 'guesty_message_send_failed');
    return false;
  }
}

export async function sendGuestySms(conversationId: string, body: string): Promise<boolean> {
  return send(conversationId, SMS_MODULE, body);
}

export async function sendGuestyEmail(conversationId: string, body: string): Promise<boolean> {
  return send(conversationId, EMAIL_MODULE, body);
}
