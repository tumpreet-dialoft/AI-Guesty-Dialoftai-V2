import Twilio from 'twilio';
import { config } from '../config';
import { log } from '../logger';

let client: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio {
  if (!client) {
    client = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }
  return client;
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  try {
    const result = await getClient().messages.create({
      to,
      from: config.TWILIO_FROM,
      body,
    });
    log.info({ sid: result.sid, to }, 'sms_sent');
    return true;
  } catch (err) {
    log.error({ err, to }, 'sms_send_failed');
    return false;
  }
}
