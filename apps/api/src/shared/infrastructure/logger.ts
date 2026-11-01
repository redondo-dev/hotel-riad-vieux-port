import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/**
 * Structured application log (Pino, one JSON line per event).
 *
 * Security rule (architecture, section 8): no password, secret, token, cookie or card data in
 * the logs, and e-mail addresses are masked. The paths below are censored automatically, even if
 * a developer logs a whole object by mistake. Request bodies are never logged.
 */

const HIDDEN = '[masqué]';

/** Field names censored wherever they appear (top level and one level down). */
const SECRET_FIELDS = [
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'secret',
  'sessionId',
  'cardNumber',
  'cvc',
] as const;
const EMAIL_FIELDS = ['email', 'customerEmail'] as const;

export const REDACTED_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...[...SECRET_FIELDS, ...EMAIL_FIELDS].flatMap((field) => [field, `*.${field}`]),
];

/** « jeanne.martin@example.org » → « j***@example.org »: enough to help support, no more. */
export function maskEmail(value: unknown): string {
  if (typeof value !== 'string') {
    return HIDDEN;
  }
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    return HIDDEN;
  }
  return `${value.charAt(0)}***${value.slice(at)}`;
}

function censor(value: unknown, path: string[]): unknown {
  const field = path[path.length - 1] ?? '';
  return (EMAIL_FIELDS as readonly string[]).includes(field) ? maskEmail(value) : HIDDEN;
}

export interface LoggerSettings {
  level: string;
  /** Human-readable output in the terminal (development only, needs pino-pretty). */
  pretty: boolean;
}

export function loggerOptions(settings: LoggerSettings): LoggerOptions {
  return {
    level: settings.level,
    base: { service: 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor },
    ...(settings.pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}

/** `destination` lets the tests capture the output; the server writes to standard output. */
export function createLogger(settings: LoggerSettings, destination?: DestinationStream): Logger {
  const options = loggerOptions(settings);
  return destination === undefined ? pino(options) : pino(options, destination);
}
