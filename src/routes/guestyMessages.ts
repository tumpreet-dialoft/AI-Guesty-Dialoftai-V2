import { Router, Request, Response } from 'express';
import { guestyFetch } from '../guesty/client';
import { findGuestIdByPhone } from '../guesty/guests';
import { findConversationByGuestId, findConversationByReservationId } from '../guesty/communication';
import { findByConfirmationCode } from '../guesty/reservationSearch';
import { log } from '../logger';

// Ops check (15 Nov 2026): did the texts and emails Ava sent through Guesty actually go out?
// "sent: true" only means Guesty accepted the post. This reads the real posts in each guest's
// conversation and returns every status-like field Guesty keeps, so delivery can be checked
// without opening the inbox. Read-only, behind the tool secret. Bodies are cut to 40 characters
// with digits masked, and no phone number or email is returned.

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUSISH = /status|deliver|error|fail|sent|read|state|reason|provider|channel|direction|type|from|author/i;
const mask = (s: unknown) => String(s ?? '').replace(/[0-9]/g, '9').replace(/[\w.+-]+@[\w.-]+/g, 'x@x').slice(0, 40);

function statusFields(o: any, path = '', out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (!o || typeof o !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(o)) {
    const p = path ? `${path}.${k}` : k;
    if (/body|html|text|to$|cc|bcc|phone|email|attachments|templateValues/i.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) statusFields(v, p, out, depth + 1);
    else if (STATUSISH.test(p)) out[p] = typeof v === 'string' ? mask(v) : v;
  }
  return out;
}

const router = Router();

router.post('/ops/guesty_messages', async (req: Request, res: Response) => {
  const phones: string[] = Array.isArray(req.body?.phones) ? req.body.phones.slice(0, 20) : [];
  const codes: string[] = Array.isArray(req.body?.confirmation_codes) ? req.body.confirmation_codes.slice(0, 20) : [];
  const since = String(req.body?.since ?? '2026-10-01');
  const out: any[] = [];
  const targets: { label: string; find: () => Promise<string | null> }[] = [
    ...phones.map((p) => ({
      label: `phone …${String(p).replace(/\D/g, '').slice(-4)}`,
      find: async () => {
        const g = await findGuestIdByPhone(p);
        return g ? findConversationByGuestId(g) : null;
      },
    })),
    ...codes.map((c) => ({
      label: `booking ${String(c).slice(0, 4)}…`,
      find: async () => {
        const r = await findByConfirmationCode(c);
        return r ? findConversationByReservationId(r.reservation_id) : null;
      },
    })),
  ];
  for (const t of targets) {
    try {
      const conv = await t.find();
      if (!conv) {
        out.push({ who: t.label, conversation: null });
        continue;
      }
      const data = (await guestyFetch('open_api', 'GET', `/communication/conversations/${encodeURIComponent(conv)}/posts?sort=-createdAt`)) as any;
      const posts = (data?.data?.posts ?? data?.posts ?? data?.results ?? []).filter((p: any) => String(p?.createdAt ?? '') >= since);
      out.push({
        who: t.label,
        conversation: `…${conv.slice(-4)}`,
        posts: posts.slice(0, 12).map((p: any) => ({
          at: String(p?.createdAt ?? '').slice(0, 16),
          channel: p?.module?.type ?? null,
          preview: mask(p?.body ?? p?.text),
          fields: statusFields(p),
          keys: Object.keys(p ?? {}),
        })),
      });
    } catch (err) {
      log.warn({ err }, 'ops_guesty_messages_failed');
      out.push({ who: t.label, error: String((err as Error)?.message ?? err).slice(0, 120) });
    }
  }
  res.json({ since, results: out });
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export { router as guestyMessagesRouter };
