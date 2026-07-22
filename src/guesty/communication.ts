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
// ponytail: email module format mirrors SMS — unverified against live account.
// If Guesty rejects it, guesty_email_send_failed will appear in logs.
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

// Sends an SMS into an existing conversation via the Unified Inbox. Mirrors the
// boolean contract of src/twilio/sms.ts so callers stay uniform.
export async function sendGuestySms(conversationId: string, body: string): Promise<boolean> {
  try {
    await guestyFetch(
      'open_api',
      'POST',
      `${CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}/send-message`,
      { module: SMS_MODULE, body },
    );
    log.info({ conversationId }, 'guesty_sms_sent');
    return true;
  } catch (err) {
    log.error({ err, conversationId }, 'guesty_sms_send_failed');
    return false;
  }
}

export async function sendGuestyEmail(
  conversationId: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    await guestyFetch(
      'open_api',
      'POST',
      `${CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}/send-message`,
      { module: EMAIL_MODULE, subject, body },
    );
    log.info({ conversationId }, 'guesty_email_sent');
    return true;
  } catch (err) {
    log.error({ err, conversationId }, 'guesty_email_send_failed');
    return false;
  }
}
