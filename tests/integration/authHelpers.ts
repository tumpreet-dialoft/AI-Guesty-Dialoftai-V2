import { vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

export const KEY = 'key_test_webhook';
export const fnBody = {
  name: 'check_availability',
  args: { check_in_date: '2099-01-01', check_out_date: '2099-01-03', number_of_guests: 2 },
};
export const callBody = { event: 'call_analyzed', call: { call_id: 'call_x', from_number: '+19035550123' } };
export const raw = (b: unknown) => JSON.stringify(b);

export function stubFetch() {
  const mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockImplementation(async (url: string) =>
    String(url).includes('oauth2')
      ? { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) }
      : {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ available: false }),
        },
  );
  return mockFetch;
}

export function post(app: Express, path: string, body: unknown) {
  return request(app).post(path).set('Content-Type', 'application/json').send(raw(body));
}
