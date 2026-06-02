import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

// TODO: Upgrade to full Retell HMAC signature verification when available.
// Retell may expose a per-account webhook signing secret that allows HMAC
// verification over the raw request body. When that ships, replace the
// shared-secret header check below with:
//   1. Read `x-retell-signature` header.
//   2. Compute HMAC-SHA256 of the raw body using the signing secret.
//   3. timingSafeEqual the computed vs. provided signature.
// Reference: https://docs.retellai.com (check webhook security section)

export function retellAuth(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-retell-secret'];

  if (typeof provided !== 'string' || provided.length === 0) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const expected = config.RETELL_SHARED_SECRET;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}
