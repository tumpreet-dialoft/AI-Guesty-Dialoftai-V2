import { z } from 'zod';

if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
}

const listingMapSchema = z
  .string()
  .transform((s) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      throw new Error('LISTING_MAP is not valid JSON');
    }
  })
  .pipe(z.record(z.string(), z.string()).refine((m) => Object.keys(m).length > 0));

const boolString = z
  .string()
  .default('false')
  .transform((s) => s === 'true');

const baseSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  RETELL_SHARED_SECRET: z.string().min(1, 'RETELL_SHARED_SECRET is required'),

  GUESTY_BE_CLIENT_ID: z.string().min(1, 'GUESTY_BE_CLIENT_ID is required'),
  GUESTY_BE_CLIENT_SECRET: z.string().min(1, 'GUESTY_BE_CLIENT_SECRET is required'),
  GUESTY_BE_BASE_URL: z.string().url().default('https://booking.guesty.com/api'),
  GUESTY_BE_TOKEN_URL: z.string().url().default('https://booking.guesty.com/oauth2/token'),

  GUESTY_OAPI_CLIENT_ID: z.string().default(''),
  GUESTY_OAPI_CLIENT_SECRET: z.string().default(''),
  GUESTY_OAPI_BASE_URL: z.string().url().default('https://open-api.guesty.com/v1'),
  GUESTY_OAPI_TOKEN_URL: z.string().url().default('https://open-api.guesty.com/oauth2/token'),

  BOOKING_SITE: z
    .string()
    .url()
    .default('https://thethomastyler.guestybookings.com'),

  TWILIO_ACCOUNT_SID: z.string().min(1, 'TWILIO_ACCOUNT_SID is required'),
  TWILIO_AUTH_TOKEN: z.string().min(1, 'TWILIO_AUTH_TOKEN is required'),
  TWILIO_FROM: z.string().min(1, 'TWILIO_FROM is required'),

  LISTING_MAP: listingMapSchema,

  ENABLE_V2_LOOKUP: boolString,
  ENABLE_V2_POST_CALL: boolString,
  ENABLE_GUESTY_SMS: boolString,

  POST_CALL_WEBHOOK_URL: z.string().default(''),
  STAFF_ALERT_WEBHOOK_URL: z.string().default(''),

  // Who a callback actually reaches. Without these, /take_message accepts a
  // callback request, delivers it to nobody, and the agent has already told the
  // guest someone is ringing them back.
  STAFF_PRIMARY_NUMBER: z.string().default(''), // E.164. Andrew.
  STAFF_BACKUP_NUMBER: z.string().default(''), // E.164. Whoever answers at 2am.

  // n8n. Owns delivery of receipts and the pre-arrival email re-send, because
  // Guesty exposes no public endpoint for either.
  RECEIPT_WEBHOOK_URL: z.string().default(''),

  // Guards /retell/inbound, which cannot use x-retell-secret because Retell does
  // not send that header on the inbound webhook. 32+ random characters.
  INBOUND_WEBHOOK_TOKEN: z.string().default(''),

  // Retell's post-call webhook signing secret, from the Retell dashboard.
  RETELL_WEBHOOK_SECRET: z.string().default(''),
});

function loadConfig() {
  const result = baseSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const err = new Error(`Invalid configuration:\n${formatted}`);
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }

  const cfg = result.data;

  if (cfg.ENABLE_V2_LOOKUP) {
    if (!cfg.GUESTY_OAPI_CLIENT_ID || !cfg.GUESTY_OAPI_CLIENT_SECRET) {
      // eslint-disable-next-line no-console
      console.error(
        'ENABLE_V2_LOOKUP is true but GUESTY_OAPI_CLIENT_ID / GUESTY_OAPI_CLIENT_SECRET are missing',
      );
      process.exit(1);
    }
  }

  if (cfg.ENABLE_V2_POST_CALL) {
    if (!cfg.GUESTY_OAPI_CLIENT_ID || !cfg.GUESTY_OAPI_CLIENT_SECRET) {
      // eslint-disable-next-line no-console
      console.error(
        'ENABLE_V2_POST_CALL is true but GUESTY_OAPI_CLIENT_ID / GUESTY_OAPI_CLIENT_SECRET are missing',
      );
      process.exit(1);
    }
  }

  if (cfg.ENABLE_GUESTY_SMS) {
    if (!cfg.GUESTY_OAPI_CLIENT_ID || !cfg.GUESTY_OAPI_CLIENT_SECRET) {
      // eslint-disable-next-line no-console
      console.error(
        'ENABLE_GUESTY_SMS is true but GUESTY_OAPI_CLIENT_ID / GUESTY_OAPI_CLIENT_SECRET are missing',
      );
      process.exit(1);
    }
  }

  if (!cfg.STAFF_PRIMARY_NUMBER && cfg.NODE_ENV === 'production') {
    // Deliberately a hard crash.
    //
    // The alternative is a service that accepts callback requests, delivers them
    // to nobody, and looks perfectly healthy while it does it. The agent promises
    // guests a call back. That promise has to land somewhere.
    // eslint-disable-next-line no-console
    console.error(
      'STAFF_PRIMARY_NUMBER is not set. take_message would accept callback requests ' +
        'and deliver them to nobody while the agent tells guests someone is calling ' +
        'them back. Refusing to start.',
    );
    process.exit(1);
  }

  return cfg;
}

export type Config = ReturnType<typeof loadConfig>;

export const config = loadConfig();
