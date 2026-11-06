import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

// Test mode: a request that came from a Retell simulation, the LLM playground, or a QA
// call/chat that set test_mode. Everything still runs (lookups, quotes, the logic under
// test) except the side effects that reach a real person or change the PMS: texts,
// emails, staff calls, staff webhooks, and the guest phone backfill. Those are logged
// as suppressed and report success, so the conversation under test follows the same
// path it would in production.
//
// Why a request-scoped store and not a flag threaded through every function: the side
// effects live four layers down (twilio/sms, guesty/communication, alerts/staffAlert),
// and a missed parameter on one path would text a real guest from a test.

const store = new AsyncLocalStorage<{ test: boolean }>();

function truthy(v: unknown): boolean {
  return typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v === true;
}

export function isTestBody(body: unknown): boolean {
  const b = (body ?? {}) as Record<string, any>;
  const call = (b.call ?? b.chat ?? {}) as Record<string, any>;
  if (call.call_id === 'playground') return true;
  const vars = { ...(call.retell_llm_dynamic_variables ?? {}), ...(call.collected_dynamic_variables ?? {}) };
  if (truthy(vars.test_mode)) return true;
  if (truthy(call.metadata?.test_mode)) return true;
  return false;
}

export function testModeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  store.run({ test: isTestBody(req.body) }, next);
}

export function inTestMode(): boolean {
  return store.getStore()?.test === true;
}

/** Run fn with test mode forced, for unit tests. */
export function withTestMode<T>(test: boolean, fn: () => T): T {
  return store.run({ test }, fn);
}
