import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';

// BUG FIX.
//
// This route used to sit BELOW `app.use(retellAuth)` in index.ts, which meant it
// demanded an `x-retell-secret` header.
//
// Retell does not send that header on the post-call webhook. That header only exists
// on CUSTOM FUNCTION calls, because we configured it there ourselves. The post-call
// webhook is signed with `x-retell-signature`.
//
// So this endpoint has returned 401 to every request Retell has ever made to it. It
// has never run. Which is almost certainly why the agent's webhook_url was still
// pointed at a public webhook.site bin: the real endpoint rejected Retell, so someone
// swapped in a URL that would accept anything, and guest names, phone numbers and
// full call transcripts have been landing in a public inspection bin ever since.
//
// It is now mounted ABOVE retellAuth and verifies Retell's signature itself.
function verifyRetellSignature(req: Request): boolean {
  // No secret configured: fail open, but say so. Better a logged gap than a silently
  // dropped webhook that nobody notices for another month.
  if (!config.RETELL_WEBHOOK_SECRET) {
    log.warn({}, 'RETELL_WEBHOOK_SECRET not set, post-call webhook is unverified');
    return true;
  }

  const provided = req.headers['x-retell-signature'];
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const expected = crypto
    .createHmac('sha256', config.RETELL_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const schema = z.object({
  call: z.object({
    call_id: z.string(),
    from_number: z.string().optional(),
    to_number: z.string().optional(),
    direction: z.string().optional(),
    start_timestamp: z.number().optional(),
    end_timestamp: z.number().optional(),
    duration_ms: z.number().optional(),
    recording_url: z.string().optional(),
    transcript: z.string().optional(),
    call_analysis: z.record(z.unknown()).optional(),
  }),
});

const router = Router();

router.post('/post_call', async (req: Request, res: Response) => {
  if (!config.ENABLE_V2_POST_CALL) {
    res.status(404).json({ error: 'feature_disabled' });
    return;
  }

  const requestId = req.headers['x-request-id'] ?? crypto.randomUUID();

  if (!verifyRetellSignature(req)) {
    log.warn({ requestId }, 'post_call_signature_invalid');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      log.warn({ requestId, errors: parsed.error.issues }, 'validation_failed');
      res.status(400).json({ error: true, message: 'Invalid request body' });
      return;
    }

    const callData = parsed.data.call;

    const summary = {
      timestamp: callData.start_timestamp ?? Date.now(),
      from_number: callData.from_number ?? 'unknown',
      intent: callData.call_analysis?.intent ?? 'unknown',
      outcome: callData.call_analysis?.outcome ?? 'unknown',
      suite: callData.call_analysis?.suite ?? null,
      quoted_total: callData.call_analysis?.quoted_total ?? null,
      link_sent: callData.call_analysis?.link_sent ?? false,
      recording_url: callData.recording_url ?? null,
    };

    // Fire-and-forget: forward to webhooks
    if (config.POST_CALL_WEBHOOK_URL) {
      fetch(config.POST_CALL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary),
      }).catch((err) => log.error({ err, requestId }, 'post_call_webhook_failed'));
    }

    // The old staff alert only fired on a successful booking. That is a sales
    // notification, not an escalation. Anything the agent PROMISED a human would
    // follow up on has to reach a human, or the promise was a lie.
    const analysis = callData.call_analysis ?? {};
    if (analysis.needs_callback === true || analysis.is_urgent === true) {
      log.warn(
        { requestId, callId: callData.call_id, urgent: analysis.is_urgent === true },
        'post_call_followup_required',
      );
    }

    if (
      config.STAFF_ALERT_WEBHOOK_URL &&
      summary.intent === 'new_booking' &&
      summary.link_sent === true
    ) {
      fetch(config.STAFF_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `New booking link sent to ${summary.from_number} for ${summary.suite ?? 'unknown suite'} — total $${summary.quoted_total ?? '?'}`,
        }),
      }).catch((err) => log.error({ err, requestId }, 'staff_alert_webhook_failed'));
    }

    log.info({ requestId, route: '/post_call', callId: callData.call_id }, 'post_call_processed');

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, requestId, route: '/post_call' }, 'handler_failed');
    res.json({ ok: true });
  }
});

export { router as postCallRouter };
