import express, { type Express, Router } from 'express';
import type { Logger } from 'pino';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.ts';
import { type DatabaseCheck, healthRouter } from './shared/http/health.ts';
import { GLOBAL_RATE_LIMIT, type RateLimitRule, rateLimiter } from './shared/http/rate-limit.ts';
import { requestContext } from './shared/http/request-context.ts';
import { corsPolicy, jsonBody, securityHeaders } from './shared/http/security.ts';

/** Prefix of every route of the API, version included. */
export const API_PREFIX = '/api/v1';

export interface AppDependencies {
  logger: Logger;
  /** Origins allowed by CORS (API_ALLOWED_ORIGINS). */
  allowedOrigins: readonly string[];
  /** Number of reverse proxies in front of the API (TRUST_PROXY). */
  trustProxy: number;
  checkDatabase: DatabaseCheck;
  /** Overall request limit; the default is the 300 requests per minute decided for the API. */
  globalRateLimit?: RateLimitRule;
  /** Adds the routes of the business modules under API_PREFIX. */
  mountRoutes?: (api: Router) => void;
}

/**
 * Builds the Express application (architecture, section 7). The order matters:
 *  1. trace identifier and request log, so that every response, even an error, has one;
 *  2. security headers, CORS, overall rate limit, JSON body limited in size;
 *  3. routes;
 *  4. 404 for unknown addresses, then the single error handler, always last.
 *
 * The application does not listen on a port itself (see main.ts): the tests drive it directly.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy);

  app.use(requestContext(deps.logger));
  app.use(securityHeaders());
  app.use(corsPolicy(deps.allowedOrigins));
  app.use(rateLimiter(deps.globalRateLimit ?? GLOBAL_RATE_LIMIT));
  app.use(jsonBody());

  const api = Router();
  api.use(healthRouter(deps.checkDatabase, deps.logger));
  deps.mountRoutes?.(api);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
