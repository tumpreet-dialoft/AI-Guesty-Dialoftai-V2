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

  // The agent transcribes a spoken number, so a dashed US number is the normal
  // case, not a bad request. It used to 400 here and fail the call.
  it('normalises a dashed US number and sends it', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test_124' });

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

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);

    const callArgs = mockCreate.mock.calls[0][0] as { to: string };
    expect(callArgs.to).toBe('+19035551234');
  });

  it('unparseable phone returns 200 with invalid_phone, never a non-200', async () => {
    const res = await request(app)
      .post('/send_booking_link')
      .set('x-retell-secret', SECRET)
      .send({
        suite_name: 'Garden Suite',
        check_in_date: '2099-07-04',
        check_out_date: '2099-07-06',
        number_of_guests: '2',
        phone_number: '12345',
      });

    // 200 on purpose: Retell treats a non-200 as a dead tool.
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(res.body.invalid_phone).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
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
