import { Router, Request, Response } from 'express';
import { config } from '../config';
import { authStatus } from '../auth/retellSignature';

const startTime = Date.now();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json');

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: version as string,
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
  });
});

// Counts of Retell requests by signature outcome, so RETELL_AUTH_MODE can be switched
// to 'signature' only after real calls verify. Counts only; nothing about any caller.
router.get('/auth-status', (_req: Request, res: Response) => {
  res.json(authStatus(config.RETELL_AUTH_MODE, Boolean(config.RETELL_WEBHOOK_SECRET)));
});

export { router as healthRouter };
