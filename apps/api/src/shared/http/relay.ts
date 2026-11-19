import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { RelayRequiredError } from '../domain/errors.ts';

/**
 * Calls of the public site's server (step S-1, security review R-1 « M-2 »). The site sends the
 * visitor's address in its own header, with a secret shared with the API (RELAY_SECRET). The
 * address is believed only with the right secret: X-Forwarded-For, which anyone can write, is
 * never trusted for the public routes. The same names are written in apps/web-public.
 */
export const RELAY_SECRET_HEADER = 'X-Riad-Relay-Secret';
export const VISITOR_IP_HEADER = 'X-Riad-Visitor-Ip';

/** Requests that came from the public site's server, with the right secret. */
const fromRelay = new WeakSet<Request>();

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Same time whatever the value sent: the secret cannot be guessed letter by letter. */
export function isRelaySecret(given: string | undefined, secret: string): boolean {
  return given !== undefined && timingSafeEqual(digest(given), digest(secret));
}

/**
 * With the right secret, the visitor's address sent by the site becomes `req.ip`: the rate
 * limits and the audit log then count each visitor, not the site. Without it, nothing changes.
 */
export function relayIdentity(secret: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (secret !== undefined && isRelaySecret(req.get(RELAY_SECRET_HEADER), secret)) {
      fromRelay.add(req);
      const visitor = req.get(VISITOR_IP_HEADER)?.trim();
      if (visitor !== undefined && isIP(visitor) !== 0) {
        Object.defineProperty(req, 'ip', { value: visitor, configurable: true, enumerable: true });
      }
    }
    next();
  };
}

/** `required` (production): only the public site's server may go further, others get 403. */
export function requireRelay(required: boolean): RequestHandler {
  return (req, _res, next) => {
    if (!required || fromRelay.has(req)) {
      next();
      return;
    }
    next(new RelayRequiredError());
  };
}
