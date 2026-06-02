import { Router, Request, Response } from 'express';

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

export { router as healthRouter };
