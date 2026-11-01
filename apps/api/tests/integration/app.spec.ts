import type { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_PREFIX, type AppDependencies, createApp } from '../../src/app.ts';
import type { RateLimitRule } from '../../src/shared/http/rate-limit.ts';
import { validated } from '../../src/shared/http/validate.ts';
import { createLogger } from '../../src/shared/infrastructure/logger.ts';

/**
 * Tests of the common HTTP layer, without any business route and without a database: the
 * database check is replaced by a function that succeeds or fails on demand. The real database
 * check is covered by health-database.spec.ts.
 */

const ALLOWED_ORIGIN = 'http://localhost:4200';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Test-only routes, to exercise validation and errors. */
function testRoutes(api: Router): void {
  api.post(
    '/test/echo',
    validated({ body: z.strictObject({ name: z.string().min(1) }) }, ({ body }, _req, res) => {
      res.status(201).json(body);
    }),
  );
  api.get('/test/boom', () => {
    throw new Error('relation "users" does not exist');
  });
}

function buildApp(overrides: Partial<AppDependencies> = {}): {
  app: ReturnType<typeof createApp>;
  logs: () => Record<string, unknown>[];
} {
  const lines: string[] = [];
  const logger = createLogger(
    { level: 'warn', pretty: false },
    {
      write: (line: string) => {
        lines.push(line);
      },
    },
  );
  const app = createApp({
    logger,
    allowedOrigins: [ALLOWED_ORIGIN],
    trustProxy: 0,
    checkDatabase: async () => undefined,
    mountRoutes: testRoutes,
    ...overrides,
  });
  return { app, logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

function expectProblem(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']?.startsWith('application/problem+json')).toBe(true);
  expect(response.body.status).toBe(status);
  expect(response.body.code).toBe(code);
  expect(response.body.traceId).toBe(response.headers['x-trace-id']);
}

describe('GET /api/v1/health', () => {
  it('answers 200 when the database answers', async () => {
    const response = await request(buildApp().app).get(`${API_PREFIX}/health`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(UUID.test(response.headers['x-trace-id'] ?? '')).toBe(true);
  });

  it('answers 503 without any internal detail when the database does not answer', async () => {
    const { app, logs } = buildApp({
      checkDatabase: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.12:5432')),
    });
    const response = await request(app).get(`${API_PREFIX}/health`);
    expectProblem(response, 503, 'SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body).includes('ECONNREFUSED')).toBe(false);
    // The cause is in the server log.
    expect(JSON.stringify(logs()).includes('ECONNREFUSED')).toBe(true);
  });
});

describe('errors', () => {
  it('answers an unknown address with a 404 in the standard format', async () => {
    const response = await request(buildApp().app).get(`${API_PREFIX}/nexiste-pas`);
    expectProblem(response, 404, 'NOT_FOUND');
  });

  it('refuses a malformed JSON body with a 400', async () => {
    const response = await request(buildApp().app)
      .post(`${API_PREFIX}/test/echo`)
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expectProblem(response, 400, 'MALFORMED_JSON');
  });

  it('refuses a body larger than 100 KB with a 413', async () => {
    const response = await request(buildApp().app)
      .post(`${API_PREFIX}/test/echo`)
      .send({ name: 'x'.repeat(110 * 1024) });
    expectProblem(response, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('lists the wrong fields with a 400', async () => {
    const response = await request(buildApp().app)
      .post(`${API_PREFIX}/test/echo`)
      .send({ name: '', extra: true });
    expectProblem(response, 400, 'VALIDATION_FAILED');
    expect(response.body.errors.map((error: { field: string }) => error.field)).toEqual([
      'name',
      'body',
    ]);
  });

  it('accepts a valid body', async () => {
    const response = await request(buildApp().app)
      .post(`${API_PREFIX}/test/echo`)
      .send({ name: 'Riad' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ name: 'Riad' });
  });

  it('hides an unexpected error from the client and logs it with its trace identifier', async () => {
    const { app, logs } = buildApp();
    const response = await request(app).get(`${API_PREFIX}/test/boom`);
    expectProblem(response, 500, 'INTERNAL_ERROR');
    const body = JSON.stringify(response.body);
    expect(body.includes('relation')).toBe(false);
    expect(body.includes('stack')).toBe(false);

    const entry = logs().find((line) => line.msg === 'erreur inattendue');
    expect(entry?.traceId).toBe(response.headers['x-trace-id']);
    expect(JSON.stringify(entry).includes('relation \\"users\\" does not exist')).toBe(true);
  });
});

describe('security', () => {
  it('sends the security headers and hides the server technology', async () => {
    const response = await request(buildApp().app).get(`${API_PREFIX}/health`);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers['strict-transport-security'] !== undefined).toBe(true);
    expect(response.headers['x-powered-by']).toBe(undefined);
  });

  it('lets an allowed site call the API with its cookies', async () => {
    const response = await request(buildApp().app)
      .get(`${API_PREFIX}/health`)
      .set('Origin', ALLOWED_ORIGIN);
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers the browser preflight of an allowed site', async () => {
    const response = await request(buildApp().app)
      .options(`${API_PREFIX}/test/echo`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('refuses any other site with a 403', async () => {
    const response = await request(buildApp().app)
      .get(`${API_PREFIX}/health`)
      .set('Origin', 'https://site-malveillant.example');
    expectProblem(response, 403, 'ORIGIN_NOT_ALLOWED');
    expect(response.headers['access-control-allow-origin']).toBe(undefined);
  });

  it('answers 429 in the standard format beyond the request limit', async () => {
    const strict: RateLimitRule = { windowMs: 60_000, limit: 2 };
    const { app } = buildApp({ globalRateLimit: strict });
    const agent = request(app);
    expect((await agent.get(`${API_PREFIX}/health`)).status).toBe(200);
    expect((await agent.get(`${API_PREFIX}/health`)).status).toBe(200);
    const response = await agent.get(`${API_PREFIX}/health`);
    expectProblem(response, 429, 'TOO_MANY_REQUESTS');
    expect(response.headers['ratelimit'] !== undefined).toBe(true);
  });
});
