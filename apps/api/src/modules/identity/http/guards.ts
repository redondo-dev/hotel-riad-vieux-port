import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import {
  AuthenticationRequiredError,
  CsrfTokenError,
  ForbiddenError,
} from '../../../shared/domain/errors.ts';
import { SESSION_ABSOLUTE_TIMEOUT_MS } from '../../../shared/http/session.ts';
import type { Role, StaffUser } from '../domain/identity-rules.ts';

/**
 * Guards of the staff routes, to place in this order on a route:
 *   requireStaff → requireRole(…) → requireCsrf → handler.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** The logged-in staff member, set by requireStaff. */
    staffUser?: StaffUser;
  }
}

/** Looks up an ACTIVE account; undefined if it no longer exists or was deactivated. */
export type FindActiveStaff = (userId: string) => Promise<StaffUser | undefined>;

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error: unknown) => {
      if (error === undefined || error === null) {
        resolve();
      } else {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/**
 * Only lets a logged-in staff member through. The account is read again at every request: a
 * deactivated account or a changed role takes effect immediately, even on an open session.
 */
export function requireStaff(findActiveStaff: FindActiveStaff): RequestHandler {
  return async (req, _res, next) => {
    const { userId, authenticatedAt } = req.session;
    if (userId === undefined || authenticatedAt === undefined) {
      throw new AuthenticationRequiredError();
    }
    if (Date.now() - authenticatedAt > SESSION_ABSOLUTE_TIMEOUT_MS) {
      await destroySession(req);
      throw new AuthenticationRequiredError();
    }
    const user = await findActiveStaff(userId);
    if (user === undefined) {
      await destroySession(req);
      throw new AuthenticationRequiredError();
    }
    req.staffUser = user;
    next();
  };
}

/** Only lets through the listed roles (after requireStaff). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.staffUser;
    if (user === undefined) {
      throw new AuthenticationRequiredError();
    }
    if (!roles.includes(user.role)) {
      throw new ForbiddenError();
    }
    next();
  };
}

/** Header carrying the anti-CSRF token, given at login and by GET /admin/session. */
export const CSRF_HEADER = 'X-CSRF-Token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

function sameToken(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Anti-CSRF protection (architecture, section 8): any request that changes data must carry, in
 * the X-CSRF-Token header, the token stored in the session. Another site can make the browser
 * send the cookie, but cannot read the token. Compared in constant time.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const expected = req.session.csrfToken;
  const received = req.get(CSRF_HEADER);
  if (expected === undefined || received === undefined || !sameToken(received, expected)) {
    throw new CsrfTokenError();
  }
  next();
};
