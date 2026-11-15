import Twilio from 'twilio';
import { config } from '../config';
import { log } from '../logger';
import { sendSms } from '../twilio/sms';
import { inTestMode } from '../util/testMode';
import { sendGuestySms } from '../guesty/communication';

export type Priority = 'urgent' | 'high' | 'normal';

export interface StaffAlert {
  caller_name: string;
  callback_number: string;
  reason: string;
  details: string;
  priority: Priority;
}

let voiceClient: Twilio.Twilio | null = null;
function getVoiceClient(): Twilio.Twilio {
  if (!voiceClient) voiceClient = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  return voiceClient;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spokenFor(a: StaffAlert): string {
  const digits = a.callback_number.replace(/\D/g, '').split('').join(' ');
  return (
    `Urgent message from the Thomas Hotel A I receptionist. ` +
    `${a.caller_name} needs a call back about ${a.reason}. ` +
    `Their number is ${digits}.`
  );
}

function smsFor(a: StaffAlert): string {
  const tag = a.priority === 'urgent' ? 'URGENT' : a.priority === 'high' ? 'ACTION' : 'FYI';
  // Business name first: carriers and Twilio's A2P review expect every text to say who sent it.
  return `Thomas Hotel Ava [${tag}] ${a.caller_name} - ${a.reason}\n${a.details}\nCall back: ${a.callback_number}`;
}

/**
 * Ring a staff member and read the message out loud, twice.
 *
 * This is not a nice-to-have, and it is worth being precise about why.
 *
 * Ava only answers the calls Andrew has ALREADY MISSED. That is the whole point of
 * the conditional-forwarding design. So by the time this fires, the transfer she
 * attempted has rung a phone that, seconds earlier, demonstrated that nobody is
 * picking it up. An SMS into that same silence is not an escalation.
 *
 * A ringing phone at 2am, with a voice saying "guest locked out of room four", is.
 */
async function callStaff(to: string, spoken: string): Promise<boolean> {
  if (inTestMode()) {
    log.info({ to, spoken }, 'test_mode_staff_call_suppressed');
    return true;
  }
  try {
    const twiml =
      `<Response><Pause length="1"/>` +
      `<Say voice="Polly.Joanna">${escapeXml(spoken)}</Say>` +
      `<Pause length="1"/>` +
      `<Say voice="Polly.Joanna">${escapeXml(spoken)}</Say>` +
      `</Response>`;

    const call = await getVoiceClient().calls.create({ to, from: config.TWILIO_FROM, twiml });
    log.info({ sid: call.sid, to }, 'staff_voice_alert_placed');
    return true;
  } catch (err) {
    log.error({ err, to }, 'staff_voice_alert_failed');
    return false;
  }
}

/**
 * The escalation ladder.
 *
 *   urgent -> SMS + ring the primary. If the ring fails, ring the backup.
 *   high   -> SMS the primary.
 *   normal -> SMS the primary, and post to the ops webhook.
 *
 * Everything fires in parallel and nothing throws: a guest is on the line, and an
 * alerting failure must not take the call down with it.
 */
export async function raiseStaffAlert(alert: StaffAlert): Promise<{ notified: string[] }> {
  const notified: string[] = [];
  const jobs: Promise<unknown>[] = [];

  const primary = config.STAFF_PRIMARY_NUMBER;
  const backup = config.STAFF_BACKUP_NUMBER;

  // Guesty text channel (15 Nov 2026): the alert posts into the "Ava Alerts - Front Desk" Guesty
  // conversation and Guesty texts it to the desk phone. While it is on, the Twilio texts are skipped:
  // every one of them was undelivered (30034) and they only add noise.
  const guestyConversation = config.GUESTY_ALERT_CONVERSATION_ID;
  const twilioSms = !guestyConversation || config.STAFF_ALERT_TWILIO_SMS;
  if (guestyConversation) {
    jobs.push(
      sendGuestySms(guestyConversation, smsFor(alert)).then((ok) => {
        if (ok) notified.push('guesty_sms');
      }),
    );
  }

  if (primary && twilioSms) {
    jobs.push(
      sendSms(primary, smsFor(alert)).then((ok) => {
        if (ok) notified.push('sms_primary');
      }),
    );
  }

  // Every alert is also texted to the front desk line, unless it is the primary already.
  const desk = config.STAFF_DESK_SMS_NUMBER;
  if (desk && desk !== primary && twilioSms) {
    jobs.push(
      sendSms(desk, smsFor(alert)).then((ok) => {
        if (ok) notified.push('sms_desk');
      }),
    );
  }

  // Urgent: ring a person. Never the desk line: it forwards to Ava, and Twilio's log shows every
  // urgent call to it went unanswered or failed (14 + 15 Nov 2026). In production the primary IS
  // the desk line, so the call goes to the backup (Andrew, set by the hotel's team).
  const voiceTargets = [primary, backup].filter(
    (n, i, all): n is string => Boolean(n) && n !== desk && all.indexOf(n) === i,
  );
  if (alert.priority === 'urgent' && voiceTargets.length) {
    jobs.push(
      (async () => {
        for (const n of voiceTargets) {
          if (await callStaff(n, spokenFor(alert))) {
            notified.push(n === primary ? 'voice_primary' : 'voice_backup');
            return;
          }
        }
      })(),
    );
  }
  if (alert.priority === 'urgent') {
    if (backup && twilioSms) {
      jobs.push(
        sendSms(backup, smsFor(alert)).then((ok) => {
          if (ok) notified.push('sms_backup');
        }),
      );
    }
  }

  if (config.STAFF_ALERT_WEBHOOK_URL && !inTestMode()) {
    jobs.push(
      fetch(config.STAFF_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: smsFor(alert), ...alert }),
      })
        .then(() => {
          notified.push('webhook');
        })
        .catch((err) => log.error({ err }, 'staff_alert_webhook_failed')),
    );
  }

  await Promise.allSettled(jobs);

  log.info({ priority: alert.priority, notified }, 'staff_alert_raised');

  if (notified.length === 0) {
    // The guest has been told someone will call them back. Nobody has been told.
    // This must be loud, and it should page whoever is on call.
    log.error({ alert }, 'STAFF_ALERT_DELIVERED_TO_NOBODY');
  }

  return { notified };
}
