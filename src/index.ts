import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { log } from './logger';
import { retellAuth } from './auth/retellAuth';
import { healthRouter } from './routes/health';
import { checkAvailabilityRouter } from './routes/checkAvailability';
import { getQuoteRouter } from './routes/getQuote';
import { sendBookingLinkRouter } from './routes/sendBookingLink';
import { lookupReservationRouter } from './routes/lookupReservation';
import { takeMessageRouter } from './routes/takeMessage';
import { sendReceiptRouter } from './routes/sendReceipt';
import { resendCheckinDetailsRouter } from './routes/resendCheckinDetails';
import { inboundLookupRouter } from './routes/inboundLookup';
import { postCallRouter } from './routes/postCall';

const app = express();

app.use(express.json());

// ---------------------------------------------------------------------------
// MOUNT ORDER MATTERS, AND IT WAS WRONG.
//
// Everything below `app.use(retellAuth)` demands an `x-retell-secret` header.
// Retell only sends that header on CUSTOM FUNCTION calls. It does NOT send it on
// the post-call webhook (signed with x-retell-signature) or the inbound webhook.
//
// postCallRouter used to sit below retellAuth, so it 401'd every request Retell
// ever made to it. It has never run once.
//
// These three authenticate on their own terms and must be mounted FIRST.
// ---------------------------------------------------------------------------
app.use(healthRouter);
app.use(inboundLookupRouter); // ?token= in the query string
app.use(postCallRouter); // verifies x-retell-signature

// ---------------------------------------------------------------------------
// Below here: Retell custom functions, which DO carry x-retell-secret.
// ---------------------------------------------------------------------------
app.use(retellAuth);
app.use(checkAvailabilityRouter);
app.use(getQuoteRouter);
app.use(sendBookingLinkRouter);
app.use(lookupReservationRouter);
app.use(takeMessageRouter);
app.use(sendReceiptRouter);
app.use(resendCheckinDetailsRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error({ err }, 'unhandled_error');
  // 200 on purpose: Retell treats a non-200 as a dead tool. But send a MESSAGE, not
  // a bare { error: true }. The prompt has a failure ladder (retry, degrade, transfer,
  // take a message) and it can only walk it if the failure is legible.
  res
    .status(200)
    .json({ ok: false, error: 'internal_error', message: 'The system is unavailable.' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    log.info({ port: config.PORT, env: config.NODE_ENV }, 'server_started');
  });
}

export { app };
