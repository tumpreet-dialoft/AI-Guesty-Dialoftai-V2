import './setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';

const mockCreate = vi.fn();

vi.mock('twilio', () => {
  return {
    default: () => ({
      messages: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    }),
  };
});

const SECRET = 'test-secret-123';

describe('POST /send_booking_link', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('happy path sends SMS and returns sent: true (root-level args)', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test_123' });

    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '+19035551234',
      });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();

    const callArgs = mockCreate.mock.calls[0][0] as { to: string; from: string; body: string };
    expect(callArgs.to).toBe('+19035551234');
    expect(callArgs.body).toContain('thethomastyler.guestybookings.com');
    expect(callArgs.body).toContain('lst_garden_004');
  });

  it('bad E.164 phone returns 400', async () => {
    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '903-555-1234',
      });

    expect(res.status).toBe(400);
    expect(res.body.sent).toBe(false);
  });

  it('Twilio failure returns sent: false', async () => {
    mockCreate.mockRejectedValue(new Error('Twilio error'));

    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '+19035551234',
      });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
  });

  it('unknown suite returns sent: false', async () => {
    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Nonexistent Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '+19035551234',
      });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
  });
});
