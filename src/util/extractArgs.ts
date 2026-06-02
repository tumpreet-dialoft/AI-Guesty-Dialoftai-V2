import { Request } from 'express';

export function extractArgs(req: Request): Record<string, unknown> {
  const body = req.body;
  if (body.args && typeof body.args === 'object') {
    return body.args;
  }
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k !== 'call' && k !== 'name') rest[k] = v;
  }
  return rest;
}
