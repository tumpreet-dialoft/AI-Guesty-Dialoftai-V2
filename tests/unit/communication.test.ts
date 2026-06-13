import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGuestyFetch = vi.fn();

vi.mock('../../src/guesty/client', () => ({
  guestyFetch: (...args: unknown[]) => mockGuestyFetch(...args),
}));

vi.mock('../../src/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  findConversationByGuestId,
  findConversationByReservationId,
  sendGuestySms,
} from '../../src/guesty/communication';

describe('guesty communication helpers', () => {
  beforeEach(() => {
    mockGuestyFetch.mockReset();
  });

  it('findConversationByGuestId filters by guest._id and reads data.conversations', async () => {
    mockGuestyFetch.mockResolvedValue({ data: { conversations: [{ _id: 'conv_1' }] } });

    const id = await findConversationByGuestId('guest_1');

    expect(id).toBe('conv_1');
    const [api, method, path] = mockGuestyFetch.mock.calls[0];
    expect(api).toBe('open_api');
    expect(method).toBe('GET');
    expect(path).toContain('/communication/conversations');
    expect(path).toContain('filters=');
    // The encoded filters JSON must carry the field + value.
    const decoded = decodeURIComponent(String(path));
    expect(decoded).toContain('"field":"guest._id"');
    expect(decoded).toContain('"value":"guest_1"');
    expect(path).toContain('sort=-lastUpdateAt');
  });

  it('findConversationByReservationId returns null when no conversations', async () => {
    mockGuestyFetch.mockResolvedValue({ data: { conversations: [] } });

    const id = await findConversationByReservationId('res_1');

    expect(id).toBeNull();
    const decoded = decodeURIComponent(String(mockGuestyFetch.mock.calls[0][2]));
    expect(decoded).toContain('"field":"reservation._id"');
    expect(decoded).toContain('"value":"res_1"');
  });

  it('findConversationByGuestId returns null when payload is null', async () => {
    mockGuestyFetch.mockResolvedValue(null);
    expect(await findConversationByGuestId('guest_x')).toBeNull();
  });

  it('sendGuestySms posts an object module and returns true', async () => {
    mockGuestyFetch.mockResolvedValue({ status: 200, data: {} });

    const ok = await sendGuestySms('conv_1', 'hello world');

    expect(ok).toBe(true);
    const [api, method, path, body] = mockGuestyFetch.mock.calls[0];
    expect(api).toBe('open_api');
    expect(method).toBe('POST');
    expect(path).toBe('/communication/conversations/conv_1/send-message');
    expect(body).toMatchObject({ body: 'hello world', module: { type: 'sms' } });
  });

  it('sendGuestySms returns false when the request throws', async () => {
    mockGuestyFetch.mockRejectedValue(new Error('boom'));
    expect(await sendGuestySms('conv_1', 'hi')).toBe(false);
  });
});
