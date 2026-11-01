import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { TooManyRequestsError } from '../domain/errors.ts';

export interface RateLimitRule {
  /** Length of the counting window, in milliseconds. */
  windowMs: number;
  /** Requests allowed per window and per key. */
  limit: number;
  /** What is counted; by default the visitor's IP address. */
  key?: (req: Request) => string;
}

/**
 * Limits the number of requests (architecture, section 5). Beyond the limit the client gets a
 * 429 in the standard error format, with the standard RateLimit headers telling when to retry.
 *
 * Counters live in memory: they restart from zero when the API restarts and are not shared
 * between several instances. Enough for one instance; a shared store (PostgreSQL) will be
 * needed if the API ever runs on several machines.
 *
 * The visitor's IP address is only reliable if TRUST_PROXY matches the hosting.
 */
export function rateLimiter(rule: RateLimitRule): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(rule.key === undefined ? {} : { keyGenerator: rule.key }),
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError());
    },
  });
}

/** Safety net over the whole API, against robots: 300 requests per minute and per IP address. */
export const GLOBAL_RATE_LIMIT: RateLimitRule = { windowMs: 60_000, limit: 300 };
