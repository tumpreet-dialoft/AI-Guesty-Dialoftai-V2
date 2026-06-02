import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { log } from './logger';
import { retellAuth } from './auth/retellAuth';
import { healthRouter } from './routes/health';
import { checkAvailabilityRouter } from './routes/checkAvailability';
import { getQuoteRouter } from './routes/getQuote';
import { sendBookingLinkRouter } from './routes/sendBookingLink';
import { lookupReservationRouter } from './routes/lookupReservation';
import { postCallRouter } from './routes/postCall';

const app = express();

app.use(express.json());

app.use(healthRouter);

app.use(retellAuth);
app.use(checkAvailabilityRouter);
app.use(getQuoteRouter);
app.use(sendBookingLinkRouter);
app.use(lookupReservationRouter);
app.use(postCallRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error({ err }, 'unhandled_error');
  res.status(200).json({ error: true });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    log.info({ port: config.PORT, env: config.NODE_ENV }, 'server_started');
  });
}

export { app };
