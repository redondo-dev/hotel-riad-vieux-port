import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { ForbiddenOriginError } from '../domain/errors.ts';
import { TRACE_ID_HEADER } from './request-context.ts';

/** Largest accepted JSON body. Photos will use a dedicated upload route, not JSON. */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Security headers (Helmet). The API only returns JSON: its content policy forbids loading
 * anything and being displayed in a frame.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
    },
  });
}

/**
 * CORS: only the public site and the staff tool may call the API from a browser
 * (API_ALLOWED_ORIGINS). Any other site gets a 403. Requests without an Origin header (the
 * hosting's health checks, server-side rendering, command-line tools) are not concerned by CORS.
 *
 * `credentials: true` lets the staff tool send its session cookie (module 3).
 */
export function corsPolicy(allowedOrigins: readonly string[]): RequestHandler {
  return cors({
    origin: (origin, callback) => {
      if (origin === undefined || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new ForbiddenOriginError());
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'If-Match', 'Idempotency-Key'],
    exposedHeaders: [TRACE_ID_HEADER, 'ETag', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  });
}

/** JSON bodies only, up to JSON_BODY_LIMIT; a malformed body ends in a 400. */
export function jsonBody(): RequestHandler {
  return express.json({ limit: JSON_BODY_LIMIT });
}
