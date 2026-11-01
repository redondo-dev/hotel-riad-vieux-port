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

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/\S+$/, 'doit être une adresse de connexion postgres://'),
  /** Enables the fictional demo data (portfolio). Never set for a real hotel. */
  DEMO_MODE: booleanFlag,
  /** Password of the demo staff accounts; required only to create them. */
  DEMO_USER_PASSWORD: z.string().min(12, 'doit contenir au moins 12 caractères').optional(),
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
