import './setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mockGuestyFetch = vi.fn();
vi.mock('../../src/guesty/client', () => ({
  guestyFetch: (...args: unknown[]) => mockGuestyFetch(...args),
}));
vi.mock('../../src/util/sleep', () => ({ sleep: () => Promise.resolve() }));

import { app } from '../../src/index';
import { todayInTyler, addDays } from '../../src/util/stayStatus';
import { cleanDoorCode, resetDoorCodeCache } from '../../src/guesty/doorCode';
import { resetDoorCodeFailures } from '../../src/routes/getDoorCode';

const SECRET = 'test-secret-123';
const today = todayInTyler();

interface World {
  checkIn: string;
  checkOut: string;
  status: string;
  keyCode?: unknown;
  customFields?: { fieldId: string; value: unknown }[];
  guestCode?: unknown; // object, or an Error to throw
}
let world: World;

function routeGuestyFetch(method: string, path: string): unknown {
  if (path.startsWith('/reservations?')) {
    return {
      results: [
        {
          _id: 'res_1',
          confirmationCode: 'GY-AbC12345',
          status: world.status,
          checkInDateLocalized: world.checkIn,
          checkOutDateLocalized: world.checkOut,
          guest: { fullName: 'Dana Fox' },
          listing: { title: 'Garden Suite' },
        },
      ],
    };
  }
  if (path.startsWith('/reservations/res_1')) {
    return { _id: 'res_1', notes: { keyCode: world.keyCode }, customFields: world.customFields ?? [] };
  }
  if (path.startsWith('/guest-code')) {
    if (world.guestCode instanceof Error) throw world.guestCode;
    return world.guestCode ?? { codes: [], locks: [] };
  }
  if (path === '/accounts/me') return { _id: 'acc_1' };
  if (path === '/accounts/acc_1/custom-fields') {
    return [
      { fieldId: 'f_door', key: 'Door Code', displayName: 'door_code', object: 'reservation' },
      { fieldId: 'f_park', key: 'Parking spot', displayName: 'parking_spot', object: 'reservation' },
    ];
  }
  return null;
}

const ask = (args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/get_door_code')
    .set('x-retell-secret', SECRET)
    .send({ args, ...extra });

const good = () => ({ confirmation_code: 'gy abc 12345', guest_name: 'Dana Fox', check_in_date: today });

describe('POST /get_door_code', () => {
  beforeEach(() => {
    mockGuestyFetch.mockReset();
    mockGuestyFetch.mockImplementation(async (_api: string, method: string, path: string) => routeGuestyFetch(method, path));
    resetDoorCodeCache();
    resetDoorCodeFailures();
    world = { checkIn: today, checkOut: addDays(today, 2), status: 'confirmed', keyCode: '4821' };
  });

  it('gives the code when name, date and confirmation number all match', async () => {
    const res = await ask(good());
    expect(res.body.ok).toBe(true);
    expect(res.body.door_code).toBe('4821');
    expect(res.body.door_code_spoken).toBe('4, 8, 2, 1');
    expect(res.body.suite).toBe('Garden Suite');
  });

  it('accepts a first name only, as callers say it', async () => {
    const res = await ask({ ...good(), guest_name: 'Dana' });
    expect(res.body.ok).toBe(true);
  });

  it.each([
    ['wrong name', { guest_name: 'Robert Miles' }],
    ['wrong date', { check_in_date: addDays(today, -3) }],
    ['wrong confirmation number', { confirmation_code: 'GY-ZZZ99999' }],
  ])('%s: transfer, same message, no code, no hint which was wrong', async (_label, override) => {
    const res = await ask({ ...good(), ...override });
    expect(res.body.ok).toBe(false);
    expect(res.body.transfer).toBe(true);
    expect(res.body.door_code).toBeUndefined();
    expect(res.body.message).toBe(
      'Those details do not match a booking we can give a code for. Transfer to the front desk now.',
    );
  });

  it('a cancelled booking gets no code', async () => {
    world.status = 'canceled';
    const res = await ask(good());
    expect(res.body.ok).toBe(false);
    expect(res.body.door_code).toBeUndefined();
  });

  it('missing confirmation number: asks, never looks anything up', async () => {
    const res = await ask({ guest_name: 'Dana Fox', check_in_date: today });
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain('confirmation number');
    expect(mockGuestyFetch).not.toHaveBeenCalled();
  });

  it('a stay next week: not yet, the code comes by email', async () => {
    world.checkIn = addDays(today, 7);
    world.checkOut = addDays(today, 9);
    const res = await ask({ ...good(), check_in_date: world.checkIn });
    expect(res.body.ok).toBe(false);
    expect(res.body.not_yet).toBe(true);
    expect(res.body.door_code).toBeUndefined();
  });

  it('arriving tomorrow and in house both get the code', async () => {
    world.checkIn = addDays(today, 1);
    world.checkOut = addDays(today, 3);
    expect((await ask({ ...good(), check_in_date: world.checkIn })).body.ok).toBe(true);
    world.checkIn = addDays(today, -1);
    world.checkOut = addDays(today, 1);
    expect((await ask({ ...good(), check_in_date: world.checkIn })).body.ok).toBe(true);
  });

  it('falls back to Locks Manager, and never refreshes the token for it', async () => {
    world.keyCode = '';
    world.guestCode = { codes: [{ code: '7731#', purpose: 'guest', status: 'active' }], locks: [] };
    const res = await ask(good());
    expect(res.body.door_code).toBe('7731#');
    expect(res.body.door_code_spoken).toBe('7, 7, 3, 1, pound');
    const gc = mockGuestyFetch.mock.calls.find((c) => String(c[2]).startsWith('/guest-code'));
    expect(gc?.[4]).toEqual({ authRetry: false });
  });

  it('skips a revoked Locks Manager code', async () => {
    world.keyCode = undefined;
    world.guestCode = { codes: [{ code: '1111', purpose: 'guest', status: 'revoked' }], locks: [] };
    const res = await ask(good());
    expect(res.body.ok).toBe(false);
    expect(res.body.transfer).toBe(true);
  });

  it('falls back to a custom field named door code, ignoring other fields', async () => {
    world.keyCode = undefined;
    world.guestCode = new Error('auth_failed 403');
    world.customFields = [
      { fieldId: 'f_park', value: '12' },
      { fieldId: 'f_door', value: 'Code: 5590' },
    ];
    const res = await ask(good());
    expect(res.body.door_code).toBe('5590');
  });

  it('no code anywhere: transfer', async () => {
    world.keyCode = 'TBD';
    const res = await ask(good());
    expect(res.body.ok).toBe(false);
    expect(res.body.transfer).toBe(true);
    expect(res.body.message).toContain('no door code');
  });

  it('test mode never returns the real code, only where it was found', async () => {
    const res = await ask(good(), { call: { call_id: 'playground' } });
    expect(res.body.test_mode).toBe(true);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('key_code');
    expect(res.body.code_shape).toBe('string[4] 9999');
    expect(JSON.stringify(res.body)).not.toContain('4821');
  });

  it('locks out after repeated wrong guesses', async () => {
    for (let i = 0; i < 8; i++) await ask({ ...good(), confirmation_code: `GY-WRONG${i}` });
    const res = await ask(good());
    expect(res.body.ok).toBe(false);
    expect(res.body.door_code).toBeUndefined();
  });

  it('a Guesty outage: transfer, never an error', async () => {
    mockGuestyFetch.mockRejectedValue(new Error('upstream_error'));
    const res = await ask(good());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.transfer).toBe(true);
  });
});

describe('cleanDoorCode', () => {
  it.each([
    ['4821', '4821'],
    [4821, '4821'],
    ['4821#', '4821#'],
    ['Code: 4821#', '4821#'],
    ['  093517 ', '093517'],
    ['front 1234 back 5678', null],
    ['TBD', null],
    ['', null],
    [null, null],
    ['12', null],
    ['Call 9034268958', null],
    ['9034268958', null],
    ['Room 4, code 2209', '2209'],
    ['Please call the front desk on arrival and we will let you in', null],
  ])('%s -> %s', (raw, want) => {
    expect(cleanDoorCode(raw)).toBe(want);
  });
});
