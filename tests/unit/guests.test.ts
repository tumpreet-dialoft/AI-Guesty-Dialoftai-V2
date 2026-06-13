import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGuestyFetch = vi.fn();

vi.mock('../../src/guesty/client', () => ({
  guestyFetch: (...args: unknown[]) => mockGuestyFetch(...args),
}));

vi.mock('../../src/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { findGuestIdByPhone, createGuest } from '../../src/guesty/guests';

describe('guesty guests helpers', () => {
  beforeEach(() => {
    mockGuestyFetch.mockReset();
  });

  it('findGuestIdByPhone strips the + (Guesty stores digits only)', async () => {
    mockGuestyFetch.mockResolvedValue({ results: [{ _id: 'guest_1' }] });

    const id = await findGuestIdByPhone('+919530760605');

    expect(id).toBe('guest_1');
    const path = String(mockGuestyFetch.mock.calls[0][2]);
    // Must search with digits only — a leading + matches nothing in Guesty.
    expect(path).toContain('q=919530760605');
    expect(path).not.toContain('%2B'); // no encoded '+'
  });

  it('findGuestIdByPhone returns null when no guest matches', async () => {
    mockGuestyFetch.mockResolvedValue({ results: [], count: 0 });
    expect(await findGuestIdByPhone('+10000000000')).toBeNull();
  });

  it('createGuest sends firstName/lastName (fullName is ignored by Guesty)', async () => {
    mockGuestyFetch.mockResolvedValue({ _id: 'guest_new' });

    const id = await createGuest({ fullName: 'Tumpreet Singh', phone: '+919530760605' });

    expect(id).toBe('guest_new');
    const [api, method, path, body] = mockGuestyFetch.mock.calls[0];
    expect(api).toBe('open_api');
    expect(method).toBe('POST');
    expect(path).toBe('/guests');
    expect(body).toMatchObject({
      firstName: 'Tumpreet',
      lastName: 'Singh',
      phone: '+919530760605',
    });
  });

  it('createGuest handles a single-word name', async () => {
    mockGuestyFetch.mockResolvedValue({ _id: 'g' });
    await createGuest({ fullName: 'Guest', phone: '+10000000000' });
    expect(mockGuestyFetch.mock.calls[0][3]).toMatchObject({ firstName: 'Guest', lastName: '' });
  });

  it('createGuest returns null on failure', async () => {
    mockGuestyFetch.mockRejectedValue(new Error('boom'));
    expect(await createGuest({ fullName: 'X Y', phone: '+1' })).toBeNull();
  });
});
