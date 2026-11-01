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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.API_ALLOWED_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_ALLOWED_ORIGINS'],
        message: 'est obligatoire en production',
      });
    }
  });

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
