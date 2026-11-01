import { join } from 'node:path';

/**
 * The tests that need PostgreSQL use ONLY the database named by TEST_DATABASE_URL (root .env
 * file, or environment), never the development or production one:
 *  - its name must contain « test »;
 *  - it must differ from DATABASE_URL.
 * Its schema is rebuilt by the migrations before each test run (see global-setup.ts).
 * Without TEST_DATABASE_URL, these tests are reported as SKIPPED, never as passed.
 */

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '..', '.env'));
} catch {
  // No .env file: the variables may come from the environment (continuous integration).
}

export const testDatabaseUrl = process.env['TEST_DATABASE_URL'] ?? '';
export const hasTestDatabase = testDatabaseUrl !== '';

function databaseOf(url: string): { name: string; host: string } {
  const parsed = new URL(url);
  return {
    name: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    host: `${parsed.hostname}:${parsed.port || '5432'}`,
  };
}

/** Throws unless TEST_DATABASE_URL names a dedicated test database. */
export function assertDedicatedTestDatabase(): void {
  let test: { name: string; host: string };
  try {
    test = databaseOf(testDatabaseUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL est illisible : attendu postgres://utilisateur:…@hôte/base');
  }
  if (!test.name.includes('test')) {
    throw new Error(
      'TEST_DATABASE_URL doit désigner une base de test dédiée (nom contenant « test »).',
    );
  }
  const developmentUrl = process.env['DATABASE_URL'];
  if (developmentUrl !== undefined && developmentUrl !== '') {
    try {
      const development = databaseOf(developmentUrl);
      if (development.name === test.name && development.host === test.host) {
        throw new Error('TEST_DATABASE_URL et DATABASE_URL désignent la même base : refusé.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('refusé')) {
        throw error;
      }
      // An unreadable DATABASE_URL cannot be the test database.
    }
  }
}
