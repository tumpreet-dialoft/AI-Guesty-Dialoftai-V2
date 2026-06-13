import './setup.guesty';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock the Guesty HTTP client so the route exercises the real orchestration
// (find guest -> find conversation -> send) without network access.
const mockGuestyFetch = vi.fn();
vi.mock('../../src/guesty/client', () => ({
  guestyFetch: (...args: unknown[]) => mockGuestyFetch(...args),
}));

// No real delays during the new-prospect conversation poll.
vi.mock('../../src/util/sleep', () => ({ sleep: () => Promise.resolve() }));

// Twilio must NOT be used when ENABLE_GUESTY_SMS is on.
const mockTwilioCreate = vi.fn();
vi.mock('twilio', () => ({
  default: () => ({ messages: { create: (...a: unknown[]) => mockTwilioCreate(...a) } }),
}));

import { app } from '../../src/index';

const SECRET = 'test-secret-123';

// Routes calls by (method, path) so each step of the orchestration resolves.
// Shapes mirror the live Guesty Open API (guests -> { results }, conversations
// -> { data: { conversations } }).
function routeGuestyFetch(method: string, path: string): unknown {
  if (method === 'GET' && path.startsWith('/guests')) {
    return { results: [{ _id: 'guest_1' }] };
  }
  if (method === 'GET' && path.startsWith('/communication/conversations')) {
    return { data: { conversations: [{ _id: 'conv_1' }] } };
  }
  if (method === 'POST' && path.includes('/send-message')) {
    return { status: 200, data: {} };
  }
  return null;
}

describe('POST /send_booking_link (ENABLE_GUESTY_SMS=true)', () => {
  beforeEach(() => {
    mockGuestyFetch.mockReset();
    mockTwilioCreate.mockReset();
    mockGuestyFetch.mockImplementation((_api: string, method: string, path: string) =>
      Promise.resolve(routeGuestyFetch(method, path)),
    );
  });

  it('existing guest: sends via Guesty, never touches Twilio', async () => {
    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '+19035551234',
        guest_name: 'Jane Doe',
      });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(mockTwilioCreate).not.toHaveBeenCalled();

    const sendCall = mockGuestyFetch.mock.calls.find((c) => String(c[2]).includes('/send-message'));
    expect(sendCall).toBeDefined();
    expect(sendCall?.[3]).toMatchObject({ body: expect.stringContaining('thethomastyler') });
  });

  it('returns sent: false when Guesty cannot resolve a conversation', async () => {
    // No guest, inquiry created, but conversation never appears.
    mockGuestyFetch.mockImplementation((_api: string, method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/guests')) return Promise.resolve({ results: [] });
      if (method === 'POST' && path === '/guests') return Promise.resolve({ _id: 'guest_new' });
      if (method === 'POST' && path === '/reservations') return Promise.resolve({ _id: 'res_1' });
      if (method === 'GET' && path.startsWith('/communication/conversations'))
        return Promise.resolve({ data: { conversations: [] } });
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '+19035550000',
      });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });
});
