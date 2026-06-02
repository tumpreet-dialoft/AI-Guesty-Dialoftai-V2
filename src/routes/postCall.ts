import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../logger';

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
