import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// No real delays during the conversation poll.
vi.mock('../../src/util/sleep', () => ({ sleep: () => Promise.resolve() }));

const findGuestIdByPhone = vi.fn();
const createGuest = vi.fn();
const createInquiryReservation = vi.fn();
const findConversationByGuestId = vi.fn();
const findConversationByReservationId = vi.fn();
const sendGuestySms = vi.fn();

vi.mock('../../src/guesty/guests', () => ({
  findGuestIdByPhone: (...a: unknown[]) => findGuestIdByPhone(...a),
  createGuest: (...a: unknown[]) => createGuest(...a),
}));
vi.mock('../../src/guesty/reservations', () => ({
  createInquiryReservation: (...a: unknown[]) => createInquiryReservation(...a),
}));
vi.mock('../../src/guesty/communication', () => ({
  findConversationByGuestId: (...a: unknown[]) => findConversationByGuestId(...a),
  findConversationByReservationId: (...a: unknown[]) => findConversationByReservationId(...a),
  sendGuestySms: (...a: unknown[]) => sendGuestySms(...a),
}));

import { sendBookingLinkViaGuesty } from '../../src/guesty/bookingSms';

const baseParams = {
  phone: '+19035551234',
  guestName: 'Jane Doe',
  listingId: 'lst_garden_004',
  checkIn: '2099-07-04',
  checkOut: '2099-07-06',
  guests: 2,
  body: 'book here: https://example.com',
};

describe('sendBookingLinkViaGuesty', () => {
  beforeEach(() => {
    findGuestIdByPhone.mockReset();
    createGuest.mockReset();
    createInquiryReservation.mockReset();
    findConversationByGuestId.mockReset();
    findConversationByReservationId.mockReset();
    sendGuestySms.mockReset();
  });

  it('existing guest with a conversation: sends, creates nothing', async () => {
    findGuestIdByPhone.mockResolvedValue('guest_1');
    findConversationByGuestId.mockResolvedValue('conv_1');
    sendGuestySms.mockResolvedValue(true);

    const sent = await sendBookingLinkViaGuesty(baseParams);

    expect(sent).toBe(true);
    expect(sendGuestySms).toHaveBeenCalledWith('conv_1', baseParams.body);
    expect(createGuest).not.toHaveBeenCalled();
    expect(createInquiryReservation).not.toHaveBeenCalled();
  });

  it('new prospect: creates guest + inquiry, polls, then sends', async () => {
    findGuestIdByPhone.mockResolvedValue(null);
    createGuest.mockResolvedValue('guest_new');
    createInquiryReservation.mockResolvedValue('res_1');
    findConversationByReservationId.mockResolvedValue('conv_new');
    sendGuestySms.mockResolvedValue(true);

    const sent = await sendBookingLinkViaGuesty(baseParams);

    expect(sent).toBe(true);
    expect(createGuest).toHaveBeenCalledWith({ fullName: 'Jane Doe', phone: baseParams.phone });
    expect(createInquiryReservation).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'lst_garden_004', guestId: 'guest_new' }),
    );
    expect(sendGuestySms).toHaveBeenCalledWith('conv_new', baseParams.body);
  });

  it('known guest without a conversation: reuses guestId, no createGuest', async () => {
    findGuestIdByPhone.mockResolvedValue('guest_1');
    findConversationByGuestId.mockResolvedValue(null);
    createInquiryReservation.mockResolvedValue('res_1');
    findConversationByReservationId.mockResolvedValue('conv_1');
    sendGuestySms.mockResolvedValue(true);

    const sent = await sendBookingLinkViaGuesty(baseParams);

    expect(sent).toBe(true);
    expect(createGuest).not.toHaveBeenCalled();
    expect(createInquiryReservation).toHaveBeenCalledWith(
      expect.objectContaining({ guestId: 'guest_1' }),
    );
  });

  it('returns false when the inquiry cannot be created', async () => {
    findGuestIdByPhone.mockResolvedValue(null);
    createGuest.mockResolvedValue('guest_new');
    createInquiryReservation.mockResolvedValue(null);

    const sent = await sendBookingLinkViaGuesty(baseParams);

    expect(sent).toBe(false);
    expect(sendGuestySms).not.toHaveBeenCalled();
  });

  it('returns false when the conversation never appears after polling', async () => {
    findGuestIdByPhone.mockResolvedValue(null);
    createGuest.mockResolvedValue('guest_new');
    createInquiryReservation.mockResolvedValue('res_1');
    findConversationByReservationId.mockResolvedValue(null);

    const sent = await sendBookingLinkViaGuesty(baseParams);

    expect(sent).toBe(false);
    expect(findConversationByReservationId).toHaveBeenCalledTimes(3);
    expect(sendGuestySms).not.toHaveBeenCalled();
  });
});
