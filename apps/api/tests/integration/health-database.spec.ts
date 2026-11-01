import { join } from 'node:path';
import type { Sequelize } from 'sequelize';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, createApp } from '../../src/app.ts';
import { createSequelize } from '../../src/shared/infrastructure/database.ts';
import { createLogger } from '../../src/shared/infrastructure/logger.ts';

/**
 * GET /health against a REAL PostgreSQL database, the dedicated test database only.
 *
 * TEST_DATABASE_URL (root .env file, or environment) must name a database whose name contains
 * « test »: the development or production database is never used by the tests. Without
 * TEST_DATABASE_URL the test is reported as SKIPPED, never as passed.
 *
 * Vitest runs the body of a skipped `describe` while collecting the tests: everything that
 * could fail (reading the URL, connecting) is therefore done in `beforeAll`, which only runs
 * when the tests really run.
 */

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '..', '.env'));
} catch {
  // No .env file: the variables may come from the environment (continuous integration).
}

const databaseUrl = process.env['TEST_DATABASE_URL'] ?? '';

/** Refuses anything but a readable URL naming a dedicated test database. */
function assertDedicatedTestDatabase(url: string): void {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL est illisible : attendu postgres://utilisateur:…@hôte/base');
  }
  if (!name.includes('test')) {
    throw new Error(
      'TEST_DATABASE_URL doit désigner une base de test dédiée (nom contenant « test »).',
    );
  }
}

describe.skipIf(databaseUrl === '')('GET /api/v1/health with the test database', () => {
  let sequelize: Sequelize | undefined;

  beforeAll(() => {
    assertDedicatedTestDatabase(databaseUrl);
    sequelize = createSequelize(databaseUrl);
  });

  afterAll(async () => {
    await sequelize?.close();
  });

  it('answers 200 when PostgreSQL answers', async () => {
    const database = sequelize;
    if (database === undefined) {
      throw new Error('connexion à la base de test non initialisée');
    }
    const app = createApp({
      logger: createLogger({ level: 'silent', pretty: false }),
      allowedOrigins: [],
      trustProxy: 0,
      checkDatabase: async () => {
        await database.authenticate({ logging: false });
      },
    });
    const response = await request(app).get(`${API_PREFIX}/health`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
