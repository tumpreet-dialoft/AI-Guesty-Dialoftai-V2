import { Router, Request, Response } from 'express';
import Twilio from 'twilio';
import { config } from '../config';
import { log } from '../logger';

// Ops check (15 Nov 2026): did Ava's texts actually arrive? Twilio returning a SID only means
// it ACCEPTED a message; carriers can still drop it (landline, unregistered 10DLC, spam
// filter). This lists recent messages from our number with Twilio's delivery status and error
// code, so "is the front desk line getting the alerts?" has an answer without asking anyone.
//
// Behind retellAuth like every tool. Never returns message bodies or full numbers: alerts carry
// guest names and phone numbers, and this must be safe to read in a terminal.

let client: Twilio.Twilio | null = null;
function twilio(): Twilio.Twilio {
  if (!client) client = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  return client;
}

const last4 = (n?: string | null) => (n ?? '').replace(/\D/g, '').slice(-4);

export function labelFor(to: string): string {
  const t = last4(to);
  const tags: string[] = [];
  if (t && t === last4(config.STAFF_DESK_SMS_NUMBER)) tags.push('desk');
  if (t && t === last4(config.STAFF_PRIMARY_NUMBER)) tags.push('primary');
  if (t && t === last4(config.STAFF_BACKUP_NUMBER)) tags.push('backup');
  return tags.length ? `${tags.join('+')} …${t}` : `guest …${t}`;
}

const router = Router();

router.get('/ops/sms_status', async (_req: Request, res: Response) => {
  try {
    const msgs = await twilio().messages.list({ from: config.TWILIO_FROM, limit: 60 });
    const recent = msgs.map((m) => ({
      at: m.dateCreated ? new Date(m.dateCreated).toISOString().slice(0, 16) : null,
      to: labelFor(m.to),
      status: m.status,
      error_code: m.errorCode ?? null,
    }));
    const summary: Record<string, Record<string, number>> = {};
    for (const r of recent) {
      const who = r.to.startsWith('guest') ? 'guests' : r.to;
      const key = r.error_code ? `${r.status} (${r.error_code})` : String(r.status);
      summary[who] = summary[who] ?? {};
      summary[who][key] = (summary[who][key] ?? 0) + 1;
    }
    const calls = await twilio().calls.list({ from: config.TWILIO_FROM, limit: 20 }).catch(() => []);
    const voice = calls.map((c) => ({
      at: c.dateCreated ? new Date(c.dateCreated).toISOString().slice(0, 16) : null,
      to: labelFor(c.to),
      status: c.status,
      seconds: Number(c.duration ?? 0),
    }));
    res.json({
      voice_alerts: voice,
      from: `…${last4(config.TWILIO_FROM)}`,
      staff: {
        primary: `…${last4(config.STAFF_PRIMARY_NUMBER)}`,
        desk: `…${last4(config.STAFF_DESK_SMS_NUMBER)}`,
        backup: config.STAFF_BACKUP_NUMBER ? `…${last4(config.STAFF_BACKUP_NUMBER)}` : null,
      },
      summary,
      recent: recent.slice(0, 25),
    });
  } catch (err) {
    log.error({ err }, 'sms_status_failed');
    res.status(502).json({ error: 'twilio_unavailable' });
  }
});

// Why are texts undelivered? 30034 = the sending number is not in a registered A2P 10DLC
// campaign. This reports what the Twilio account has registered, read-only.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err: any) {
    return { error: String(err?.message ?? err).slice(0, 160) };
  }
}

router.get('/ops/sms_registration', async (_req: Request, res: Response) => {
  const m = (twilio() as any).messaging.v1;
  const from4 = last4(config.TWILIO_FROM);
  const brands = await safe(async () =>
    (await m.brandRegistrations.list({ limit: 10 })).map((b: any) => ({
      status: b.status, brand_type: b.brandType, identity: b.identityStatus, created: b.dateCreated,
      failure: b.failureReason ?? b.errors ?? null,
    })),
  );
  const services = await safe(async () => {
    const out: any[] = [];
    for (const sv of await m.services.list({ limit: 20 })) {
      const numbers = await safe(async () => (await m.services(sv.sid).phoneNumbers.list({ limit: 50 })).map((n: any) => last4(n.phoneNumber)));
      const campaigns = await safe(async () =>
        (await m.services(sv.sid).usAppToPerson.list({ limit: 10 })).map((c: any) => ({
          status: c.campaignStatus, usecase: c.usAppToPersonUsecase, errors: c.errors ?? null, created: c.dateCreated,
        })),
      );
      out.push({ name: sv.friendlyName, has_ava_number: Array.isArray(numbers) ? numbers.includes(from4) : numbers, campaigns });
    }
    return out;
  });
  const tollfree = await safe(async () =>
    (await m.tollfreeVerifications.list({ limit: 10 })).map((t: any) => ({ status: t.status, rejection: t.rejectionReason ?? null })),
  );
  res.json({ from: `…${from4}`, brands, services, tollfree });
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export { router as smsStatusRouter };
