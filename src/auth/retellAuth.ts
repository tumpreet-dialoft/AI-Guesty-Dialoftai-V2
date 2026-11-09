import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { checkAndCount } from './retellSignature';

// Custom functions. Two modes (RETELL_AUTH_MODE, see config.ts):
//   secret    : the x-retell-secret header must match RETELL_SHARED_SECRET. The
//               signature is still checked and counted when a key is set.
//   signature : a valid x-retell-signature is required; x-retell-secret is ignored.
// The shared secret travels in the agent's tool headers, so anyone who has seen the
// agent config can use it. The signature needs the Retell API key, which never leaves
// Retell or this server.
export function retellAuth(req: Request, res: Response, next: NextFunction): void {
  const signed = checkAndCount('functions', req, config.RETELL_WEBHOOK_SECRET);

  if (config.RETELL_AUTH_MODE === 'signature') {
    if (!signed) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
    return;
  }

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
