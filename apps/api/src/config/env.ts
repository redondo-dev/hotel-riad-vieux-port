import { z } from 'zod';

/**
 * Environment variables, checked once at startup. A missing or malformed value stops the
 * process immediately with an explicit message, instead of failing later in the middle of a
 * request. Error messages name the variable but never repeat its value (it may be a secret).
 */

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * « NAME= » with nothing after it (as in .env.example) means « not set », not « empty value ».
 */
function emptyAsMissing<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

/**
 * Comma-separated list of origins allowed to call the API from a browser (CORS), for example
 * « https://riad-vieux-port.example,https://gestion.riad-vieux-port.example ». Each entry must
 * be a bare origin: scheme, host and optional port, without path. No wildcard is accepted.
 */
const originList = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const origins: string[] = [];
    for (const entry of value.split(',')) {
      const candidate = entry.trim();
      if (candidate === '') {
        continue;
      }
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'contient une adresse illisible' });
        return z.NEVER;
      }
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.origin !== candidate.replace(/\/$/, '')
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'doit lister des origines http(s) sans chemin, séparées par des virgules',
        });
        return z.NEVER;
      }
      origins.push(url.origin);
    }
    return origins;
  });

/** Variables without a default in production: the API refuses to start without them. */
const REQUIRED_IN_PRODUCTION = [
  'API_ALLOWED_ORIGINS',
  'SESSION_SECRET',
  'ADMIN_APP_URL',
  'STORAGE_DIR',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PUBLIC_SITE_URL',
] as const;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/\S+$/, 'doit être une adresse de connexion postgres://'),
    /** Enables the fictional demo data (portfolio). Never set for a real hotel. */
    DEMO_MODE: booleanFlag,
    /** Password of the demo staff accounts; required only to create them. */
    DEMO_USER_PASSWORD: emptyAsMissing(
      z.string().min(12, 'doit contenir au moins 12 caractères').optional(),
    ),

    /** Port the HTTP server listens on. */
    API_PORT: z.coerce
      .number()
      .int()
      .min(1, 'doit être un port entre 1 et 65535')
      .max(65535, 'doit être un port entre 1 et 65535')
      .default(3000),
    /** Origins allowed by CORS: the public site and the staff tool, nothing else. */
    API_ALLOWED_ORIGINS: originList,
    /**
     * Number of reverse proxies in front of the API (0 = none). Express then reads the visitor's
     * IP address from X-Forwarded-For. A wrong value lets visitors forge their IP address and
     * bypass the rate limits: set it only once the hosting is known.
     */
    TRUST_PROXY: z.coerce
      .number()
      .int()
      .min(0, 'doit être un entier entre 0 et 5')
      .max(5, 'doit être un entier entre 0 et 5')
      .default(0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /**
     * Signs the staff session cookies. Random, at least 32 characters, different in each
     * environment. Required to start the HTTP server (not for the database commands).
     */
    SESSION_SECRET: emptyAsMissing(
      z.string().min(32, 'doit contenir au moins 32 caractères').optional(),
    ),
    /**
     * Address of the staff tool, used to build the links sent by e-mail (password set-up and
     * reset). Defaults to the local staff tool in development.
     */
    ADMIN_APP_URL: emptyAsMissing(
      z.url({ protocol: /^https?$/, error: 'doit être une adresse http(s) valide' }).optional(),
    ),
    /**
     * Folder of the photos sent by the staff. Defaults to « storage » at the root of the
     * repository (ignored by Git) outside production; in production, a persistent disk until
     * an S3-compatible storage is set up.
     */
    STORAGE_DIR: emptyAsMissing(z.string().min(1).optional()),
    /**
     * Secret key of Stripe (online payment, step R-3): « sk_test_… » outside production. Without
     * it in development, online bookings answer « paiement non configuré ». Never in Git.
     */
    STRIPE_SECRET_KEY: emptyAsMissing(
      z
        .string()
        .regex(/^sk_(test|live)_[A-Za-z0-9]+$/, 'doit être une clé secrète Stripe (sk_…)')
        .optional(),
    ),
    /**
     * Secret of the notifications of Stripe (webhook, step R-5): « whsec_… », given by
     * « stripe listen » in development and by the dashboard of Stripe in production. Without it
     * in development, the bookings paid stay « en attente ». Never in Git.
     */
    STRIPE_WEBHOOK_SECRET: emptyAsMissing(
      z
        .string()
        .regex(/^whsec_[A-Za-z0-9]+$/, 'doit être un secret de webhook Stripe (whsec_…)')
        .optional(),
    ),
    /**
     * Address of the public site: the payment page sends visitors back there, and only there.
     * Defaults to the local public site in development.
     */
    PUBLIC_SITE_URL: emptyAsMissing(
      z.url({ protocol: /^https?$/, error: 'doit être une adresse http(s) valide' }).optional(),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      // A real payment must never be taken from a development machine or by the tests.
      if (env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'ne doit pas être une clé de production (sk_live_) hors production',
        });
      }
      return;
    }
    for (const name of REQUIRED_IN_PRODUCTION) {
      const value = env[name];
      if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'est obligatoire en production' });
      }
    }
    if (env.PUBLIC_SITE_URL?.startsWith('http:') === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_SITE_URL'],
        message: 'doit utiliser https en production',
      });
    }
    if (env.ADMIN_APP_URL?.startsWith('http:') === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_APP_URL'],
        message: 'doit utiliser https en production',
      });
    }
  });

/** Staff tool served by `ng serve` in development (port reserved in API_ALLOWED_ORIGINS). */
export const DEFAULT_ADMIN_APP_URL = 'http://localhost:4300';

/** Public site served by `ng serve` in development. */
export const DEFAULT_PUBLIC_SITE_URL = 'http://localhost:4200';

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join(' ; ');
    throw new Error(`Configuration invalide : ${details}`);
  }
  return result.data;
}
