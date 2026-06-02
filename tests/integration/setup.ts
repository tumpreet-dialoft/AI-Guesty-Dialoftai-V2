import { vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.LOG_LEVEL = 'silent';
process.env.RETELL_SHARED_SECRET = 'test-secret-123';
process.env.GUESTY_BE_CLIENT_ID = 'test_be_id';
process.env.GUESTY_BE_CLIENT_SECRET = 'test_be_secret';
process.env.GUESTY_BE_BASE_URL = 'https://booking.guesty.com/api';
process.env.GUESTY_OAPI_CLIENT_ID = 'test_oapi_id';
process.env.GUESTY_OAPI_CLIENT_SECRET = 'test_oapi_secret';
process.env.GUESTY_OAPI_BASE_URL = 'https://open-api.guesty.com/v1';
process.env.BOOKING_SITE = 'https://thethomastyler.guestybookings.com';
process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
process.env.TWILIO_FROM = '+15551234567';
process.env.LISTING_MAP = JSON.stringify({
  'Garden Suite': 'lst_garden_123',
  'Premium Suite': 'lst_premium_456',
  'Garden Suite ADA': 'lst_ada_789',
});
process.env.ENABLE_V2_LOOKUP = 'false';
process.env.ENABLE_V2_POST_CALL = 'false';

vi.mock('../../src/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));
