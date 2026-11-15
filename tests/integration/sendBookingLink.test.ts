import './setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { todayInTyler } from '../../src/util/stayStatus';

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

  // Michelle, 12 Nov 2026: a same-day booking needs the lock system updated, so text the team.
  describe('same-day booking alert', () => {
    const tomorrow = (d: string) => {
      const t = new Date(`${d}T12:00:00Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString().slice(0, 10);
    };
    const send = (check_in_date: string, check_out_date: string) =>
      request(app)
        .post('/send_booking_link')
        .set('x-retell-secret', SECRET)
        .send({
          suite_name: 'Garden Suite',
          check_in_date,
          check_out_date,
          number_of_guests: '2',
          phone_number: '+19035551234',
          guest_name: 'Dana Fox',
        });

    it('texts the front desk when the stay starts today', async () => {
      mockCreate.mockResolvedValue({ sid: 'SM_test_sd' });
      const today = todayInTyler();
      const res = await send(today, tomorrow(today));

      expect(res.body.sent).toBe(true);
      const bodies = mockCreate.mock.calls.map((c) => c[0] as { to: string; body: string });
      expect(bodies).toHaveLength(2);
      expect(bodies[0].to).toBe('+19035551234');
      const alert = bodies.find((b) => b.to === '+19034268958');
      expect(alert?.body).toContain('SAME-DAY booking link');
      expect(alert?.body).toContain('Garden Suite tonight');
      expect(alert?.body).toContain('Dana Fox');
      expect(alert?.body).toContain('Update the lock system');
    });

    it('sends no alert for a stay on another day', async () => {
      mockCreate.mockResolvedValue({ sid: 'SM_test_fut' });
      const res = await send('2099-07-04', '2099-07-06');
      expect(res.body.sent).toBe(true);
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('sends no alert when the guest link itself failed', async () => {
      mockCreate.mockRejectedValue(new Error('twilio down'));
      const today = todayInTyler();
      const res = await send(today, tomorrow(today));
      expect(res.body.sent).toBe(false);
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });
});
