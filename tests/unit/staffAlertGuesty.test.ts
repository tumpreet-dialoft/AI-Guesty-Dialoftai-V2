import { describe, it, expect, vi, beforeEach } from 'vitest';

// 15 Nov 2026: staff alerts go through Guesty's texting while the Twilio campaign is rejected.
const { sms, guestySms, voiceCreate, cfg } = vi.hoisted(() => ({
  sms: vi.fn(async (_to: string, _body: string) => true),
  guestySms: vi.fn(async (_conv: string, _body: string) => true),
  voiceCreate: vi.fn(async (_args: { to: string }) => ({ sid: 'CA1' })),
  cfg: {
    STAFF_PRIMARY_NUMBER: '+19034268958',
    STAFF_BACKUP_NUMBER: '+19703761029',
    STAFF_DESK_SMS_NUMBER: '+19034268958',
    STAFF_ALERT_WEBHOOK_URL: '',
    TWILIO_ACCOUNT_SID: 'AC1',
    TWILIO_AUTH_TOKEN: 't',
    TWILIO_FROM: '+19032661978',
    GUESTY_ALERT_CONVERSATION_ID: 'conv_alerts',
    STAFF_ALERT_TWILIO_SMS: false,
  },
}));
vi.mock('../../src/config', () => ({ config: cfg }));
vi.mock('../../src/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/twilio/sms', () => ({ sendSms: (to: string, body: string) => sms(to, body) }));
vi.mock('../../src/guesty/communication', () => ({ sendGuestySms: (c: string, b: string) => guestySms(c, b) }));
vi.mock('twilio', () => ({ default: () => ({ calls: { create: (a: { to: string }) => voiceCreate(a) } }) }));

import { raiseStaffAlert } from '../../src/alerts/staffAlert';

const alert = (priority: 'urgent' | 'high' | 'normal', reason = 'callback') => ({
  caller_name: 'Monica Green',
  callback_number: '+19365550142',
  reason,
  details: 'Second reservation for Nov 25-27; the transfer did not connect.',
  priority,
});

beforeEach(() => {
  sms.mockClear();
  guestySms.mockReset();
  guestySms.mockImplementation(async () => true);
  voiceCreate.mockClear();
  cfg.GUESTY_ALERT_CONVERSATION_ID = 'conv_alerts';
  cfg.STAFF_ALERT_TWILIO_SMS = false;
});

describe('staff alerts through Guesty', () => {
  it.each(['normal', 'high', 'urgent'] as const)('%s alert is texted through the alert conversation, no Twilio texts', async (p) => {
    const { notified } = await raiseStaffAlert(alert(p));
    expect(guestySms).toHaveBeenCalledOnce();
    expect(guestySms.mock.calls[0][0]).toBe('conv_alerts');
    expect(sms).not.toHaveBeenCalled();
    expect(notified).toContain('guesty_sms');
  });

  it('the text names the hotel, the caller, the reason and the call-back number', async () => {
    await raiseStaffAlert(alert('high', 'SAME-DAY booking link'));
    const body = guestySms.mock.calls[0][1];
    expect(body).toMatch(/^Thomas Hotel Ava \[ACTION\] Monica Green - SAME-DAY booking link/);
    expect(body).toContain('Call back: +19365550142');
  });

  it('urgent still rings a phone, never the desk line that forwards to Ava', async () => {
    await raiseStaffAlert(alert('urgent'));
    expect(voiceCreate.mock.calls.map((c) => c[0].to)).not.toContain('+19034268958');
    expect(voiceCreate.mock.calls.map((c) => c[0].to)).toEqual(['+19703761029']);
  });

  it('non-urgent alerts never place a call', async () => {
    await raiseStaffAlert(alert('high'));
    await raiseStaffAlert(alert('normal'));
    expect(voiceCreate).not.toHaveBeenCalled();
  });

  it('if Guesty fails, the failure is visible (not reported as notified)', async () => {
    guestySms.mockImplementation(async () => false);
    const { notified } = await raiseStaffAlert(alert('normal'));
    expect(notified).not.toContain('guesty_sms');
  });

  it('with no alert conversation set, behaviour is exactly as before (Twilio texts)', async () => {
    cfg.GUESTY_ALERT_CONVERSATION_ID = '';
    const { notified } = await raiseStaffAlert(alert('normal'));
    expect(guestySms).not.toHaveBeenCalled();
    expect(sms).toHaveBeenCalled();
    expect(notified).toContain('sms_primary');
  });

  it('a comma-separated list texts every conversation (desk + Michelle), once each', async () => {
    cfg.GUESTY_ALERT_CONVERSATION_ID = 'conv_alerts, conv_michelle,conv_alerts';
    const { notified } = await raiseStaffAlert(alert('high'));
    expect(guestySms.mock.calls.map((c) => c[0])).toEqual(['conv_alerts', 'conv_michelle']);
    expect(guestySms.mock.calls[0][1]).toBe(guestySms.mock.calls[1][1]);
    expect(sms).not.toHaveBeenCalled();
    expect(notified).toContain('guesty_sms');
  });

  it('one conversation failing does not stop the other', async () => {
    cfg.GUESTY_ALERT_CONVERSATION_ID = 'conv_alerts,conv_michelle';
    guestySms.mockImplementation(async (c: string) => {
      if (c === 'conv_alerts') throw new Error('boom');
      return true;
    });
    const { notified } = await raiseStaffAlert(alert('normal'));
    expect(guestySms).toHaveBeenCalledTimes(2);
    expect(notified).toContain('guesty_sms');
  });

  it('STAFF_ALERT_TWILIO_SMS=true sends both (for when the Twilio campaign is approved)', async () => {
    cfg.STAFF_ALERT_TWILIO_SMS = true;
    const { notified } = await raiseStaffAlert(alert('normal'));
    expect(guestySms).toHaveBeenCalledOnce();
    expect(sms).toHaveBeenCalled();
    expect(notified).toEqual(expect.arrayContaining(['guesty_sms', 'sms_primary']));
  });
});
