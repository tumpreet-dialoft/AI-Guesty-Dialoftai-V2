import './setup';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

const mockList = vi.fn();
vi.mock('twilio', () => ({
  default: () => ({ messages: { list: (...a: unknown[]) => mockList(...a), create: vi.fn() } }),
}));

import { app } from '../../src/index';

describe('GET /ops/sms_status', () => {
  it('needs the tool secret', async () => {
    const res = await request(app).get('/ops/sms_status');
    expect(res.status).toBe(401);
  });

  it('labels staff lines, never returns bodies or full numbers', async () => {
    mockList.mockResolvedValue([
      { dateCreated: new Date('2026-11-11T14:28:00Z'), to: '+19034268958', status: 'undelivered', errorCode: 30006, body: '[ACTION] Dana - test' },
      { dateCreated: new Date('2026-11-12T10:00:00Z'), to: '+19035551234', status: 'delivered', errorCode: null, body: 'link' },
    ]);
    const res = await request(app).get('/ops/sms_status').set('x-retell-secret', 'test-secret-123');
    expect(res.status).toBe(200);
    expect(res.body.recent[0]).toEqual({ at: '2026-11-11T14:28', to: 'desk …8958', status: 'undelivered', error_code: 30006 });
    expect(res.body.summary['desk …8958']).toEqual({ 'undelivered (30006)': 1 });
    expect(res.body.summary.guests).toEqual({ delivered: 1 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Dana');
    expect(text).not.toContain('9035551234');
  });
});
