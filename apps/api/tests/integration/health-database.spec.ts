import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { API_PREFIX, createApp } from '../../src/app.ts';
import { createSequelize } from '../../src/shared/infrastructure/database.ts';
import { createLogger } from '../../src/shared/infrastructure/logger.ts';

/**
 * GET /health against a REAL PostgreSQL database, the dedicated test database only.
 *
 * TEST_DATABASE_URL (root .env file, or environment) must name a database whose name contains
 * « test »: the development or production database is never used by the tests. Without
 * TEST_DATABASE_URL the test is reported as SKIPPED, never as passed.
 */

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '..', '.env'));
} catch {
  // No .env file: the variables may come from the environment (continuous integration).
}

const databaseUrl = process.env['TEST_DATABASE_URL'];

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

describe.skipIf(databaseUrl === undefined || databaseUrl === '')(
  'GET /api/v1/health with the test database',
  () => {
    const url = databaseUrl ?? '';
    if (!databaseName(url).includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL doit désigner une base de test dédiée (nom contenant « test »).',
      );
    }
    const sequelize = createSequelize(url);

    afterAll(async () => {
      await sequelize.close();
    });

    it('answers 200 when PostgreSQL answers', async () => {
      const app = createApp({
        logger: createLogger({ level: 'silent', pretty: false }),
        allowedOrigins: [],
        trustProxy: 0,
        checkDatabase: async () => {
          await sequelize.authenticate({ logging: false });
        },
      });
      const response = await request(app).get(`${API_PREFIX}/health`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  },
);
