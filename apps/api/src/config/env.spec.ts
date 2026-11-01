import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.ts';

const base = { DATABASE_URL: 'postgres://riad@localhost:5432/riad_dev' };

function errorOf(source: Record<string, string>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('loadEnv', () => {
  it('applies safe defaults for the HTTP server', () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(3000);
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.API_ALLOWED_ORIGINS).toEqual([]);
  });

  it('reads the allowed origins as a list', () => {
    const env = loadEnv({
      ...base,
      API_ALLOWED_ORIGINS: 'http://localhost:4200, https://gestion.riad-vieux-port.example/',
    });
    expect(env.API_ALLOWED_ORIGINS).toEqual([
      'http://localhost:4200',
      'https://gestion.riad-vieux-port.example',
    ]);
  });

  it('refuses a wildcard, a path or another scheme in the allowed origins', () => {
    for (const value of ['*', 'https://site.example/admin', 'ftp://site.example']) {
      expect(errorOf({ ...base, API_ALLOWED_ORIGINS: value }).includes('API_ALLOWED_ORIGINS')).toBe(
        true,
      );
    }
  });

  it('requires the allowed origins in production', () => {
    expect(
      errorOf({ ...base, NODE_ENV: 'production' }).includes(
        'API_ALLOWED_ORIGINS est obligatoire en production',
      ),
    ).toBe(true);
  });

  it('refuses an invalid port or proxy count', () => {
    expect(errorOf({ ...base, API_PORT: '70000' }).includes('API_PORT')).toBe(true);
    expect(errorOf({ ...base, TRUST_PROXY: '-1' }).includes('TRUST_PROXY')).toBe(true);
  });

  it('treats an empty optional variable as not set, as written in .env.example', () => {
    expect(loadEnv({ ...base, DEMO_USER_PASSWORD: '' }).DEMO_USER_PASSWORD).toBe(undefined);
    expect(errorOf({ ...base, DEMO_USER_PASSWORD: 'court' }).includes('DEMO_USER_PASSWORD')).toBe(
      true,
    );
  });

  it('requires the session secret and the staff tool address in production', () => {
    const message = errorOf({
      ...base,
      NODE_ENV: 'production',
      API_ALLOWED_ORIGINS: 'https://gestion.riad-vieux-port.example',
      ADMIN_APP_URL: 'http://gestion.riad-vieux-port.example',
    });
    expect(message.includes('SESSION_SECRET est obligatoire en production')).toBe(true);
    expect(message.includes('ADMIN_APP_URL doit utiliser https en production')).toBe(true);
  });

  it('refuses a session secret shorter than 32 characters', () => {
    expect(errorOf({ ...base, SESSION_SECRET: 'trop-court' }).includes('SESSION_SECRET')).toBe(
      true,
    );
    expect(loadEnv({ ...base, SESSION_SECRET: 'x'.repeat(32) }).SESSION_SECRET).toBe(
      'x'.repeat(32),
    );
  });

  it('never repeats a secret value in its error message', () => {
    const message = errorOf({ DATABASE_URL: 'mysql://user:s3cret@host/db' });
    expect(message.includes('DATABASE_URL')).toBe(true);
    expect(message.includes('s3cret')).toBe(false);
  });
});
