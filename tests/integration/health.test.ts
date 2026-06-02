import './setup';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';

describe('GET /health', () => {
  it('returns status ok with version and uptimeSec', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('works without x-retell-secret header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
