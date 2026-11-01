import type { Sequelize } from 'sequelize';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, createApp } from '../../src/app.ts';
import { createSequelize } from '../../src/shared/infrastructure/database.ts';
import { createLogger } from '../../src/shared/infrastructure/logger.ts';
import { hasTestDatabase, testDatabaseUrl } from '../support/test-database.ts';

/**
 * GET /health against a REAL PostgreSQL database: the dedicated test database only
 * (see tests/support/test-database.ts). Skipped without TEST_DATABASE_URL.
 */

describe.skipIf(!hasTestDatabase)('GET /api/v1/health with the test database', () => {
  let sequelize: Sequelize | undefined;

  beforeAll(() => {
    sequelize = createSequelize(testDatabaseUrl);
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
