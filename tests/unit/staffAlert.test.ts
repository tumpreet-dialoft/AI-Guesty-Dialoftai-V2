import { describe, it, expect, vi, beforeEach } from 'vitest';

const sms = vi.fn(async (_to: string, _body: string) => true);
const voiceCreate = vi.fn(async (_args: { to: string }) => ({ sid: 'CA1' }));

vi.mock('../../src/config', () => ({
  config: {
    STAFF_PRIMARY_NUMBER: '+19705550101',
    STAFF_BACKUP_NUMBER: '',
    STAFF_DESK_SMS_NUMBER: '+19034268958',
    STAFF_ALERT_WEBHOOK_URL: '',
    TWILIO_ACCOUNT_SID: 'AC1',
    TWILIO_AUTH_TOKEN: 't',
    TWILIO_FROM: '+19035550100',
  },
}));
vi.mock('../../src/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/twilio/sms', () => ({ sendSms: (to: string, body: string) => sms(to, body) }));
vi.mock('twilio', () => ({ default: () => ({ calls: { create: (a: { to: string }) => voiceCreate(a) } }) }));

import { raiseStaffAlert } from '../../src/alerts/staffAlert';

const alert = (priority: 'urgent' | 'high' | 'normal') => ({
  caller_name: 'Pat Greene',
  callback_number: '+19035550123',
  reason: 'callback',
  details: 'Wants a call back.',
  priority,
});

beforeEach(() => {
  sms.mockClear();
  voiceCreate.mockClear();
});

describe('raiseStaffAlert: front desk line (Michelle, 9 Nov 2026)', () => {
  it('texts the desk line as well as the primary', async () => {
    const { notified } = await raiseStaffAlert(alert('normal'));
    expect(sms.mock.calls.map((c) => c[0]).sort()).toEqual(['+19034268958', '+19705550101']);
    expect(notified).toContain('sms_desk');
    expect(notified).toContain('sms_primary');
  });

  it('never rings the desk line, because it forwards calls to Ava herself', async () => {
    await raiseStaffAlert(alert('urgent'));
    const dialled = voiceCreate.mock.calls.map((c) => c[0].to);
    expect(dialled).not.toContain('+19034268958');
  });

  it('still reaches the desk when the primary text fails', async () => {
    sms.mockImplementation(async (to: string) => to === '+19034268958');
    const { notified } = await raiseStaffAlert(alert('high'));
    expect(notified).toEqual(['sms_desk']);
    sms.mockImplementation(async () => true);
  });
});
