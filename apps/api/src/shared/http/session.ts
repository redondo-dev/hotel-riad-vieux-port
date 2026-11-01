import connectPgSimple from 'connect-pg-simple';
import type { RequestHandler } from 'express';
import session from 'express-session';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

/**
 * Server-side sessions of the staff (architecture, section 8): the browser only holds a signed
 * random identifier; the session itself is stored in PostgreSQL (table user_sessions).
 *
 *  - cookie HttpOnly (unreadable by scripts), SameSite=Strict, Secure in production, limited
 *    to the staff part of the API (/api/v1/admin);
 *  - logged out after 30 minutes without activity (`rolling` renews the delay at each request);
 *  - logged out 12 hours after login whatever the activity (checked by requireStaff).
 */

declare module 'express-session' {
  interface SessionData {
    userId: string;
    /** Login time (milliseconds since 1970), for the 12-hour limit. */
    authenticatedAt: number;
    /** Anti-CSRF token, required on every request that changes data. */
    csrfToken: string;
  }
}

export const SESSION_COOKIE_NAME = 'riad.sid';
export const SESSION_COOKIE_PATH = '/api/v1/admin';
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export type SessionStore = session.Store;

export interface SessionStoreOptions {
  /** Removes expired sessions every 15 minutes; disabled in the tests. */
  pruneExpired?: boolean;
}

export function createSessionStore(
  pool: Pool,
  logger: Logger,
  options: SessionStoreOptions = {},
): SessionStore {
  const PgStore = connectPgSimple(session);
  return new PgStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: options.pruneExpired === false ? false : 15 * 60,
    errorLog: (...args: unknown[]) => {
      logger.error({ details: args.map(String) }, 'stockage des sessions en erreur');
    },
  });
}

export interface SessionSettings {
  store: SessionStore;
  secret: string;
  /** True in production: the cookie is only sent over HTTPS. */
  secureCookies: boolean;
}

export function staffSessions(settings: SessionSettings): RequestHandler {
  return session({
    name: SESSION_COOKIE_NAME,
    store: settings.store,
    secret: settings.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: settings.secureCookies,
      path: SESSION_COOKIE_PATH,
      maxAge: SESSION_IDLE_TIMEOUT_MS,
    },
  });
}
