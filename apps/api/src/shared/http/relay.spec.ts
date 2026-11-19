import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.ts';
import { rateLimiter } from './rate-limit.ts';
import {
  isRelaySecret,
  RELAY_SECRET_HEADER,
  relayIdentity,
  requireRelay,
  VISITOR_IP_HEADER,
} from './relay.ts';

const SECRET = 'r'.repeat(40);

const statusOf: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error instanceof AppError ? error.status : 500).json({ code: error.code });
};

function appWith(options: { required?: boolean; limit?: number } = {}) {
  const app = express();
  app.use(relayIdentity(SECRET));
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  app.get('/limited', rateLimiter({ windowMs: 60_000, limit: options.limit ?? 1 }), (_r, res) => {
    res.json({});
  });
  app.get('/site-only', requireRelay(options.required ?? true), (_req, res) => {
    res.json({});
  });
  app.use(statusOf);
  return app;
}

describe('relay of the public site', () => {
  it('compares the secret whatever its length', () => {
    expect(isRelaySecret(SECRET, SECRET)).toBe(true);
    expect(isRelaySecret('court', SECRET)).toBe(false);
    expect(isRelaySecret(undefined, SECRET)).toBe(false);
  });

  it('believes the visitor sent by the site only with the right secret', async () => {
    const app = appWith();
    const relayed = await request(app)
      .get('/ip')
      .set(RELAY_SECRET_HEADER, SECRET)
      .set(VISITOR_IP_HEADER, '203.0.113.7');
    expect(relayed.body.ip).toBe('203.0.113.7');

    const forged = await request(app)
      .get('/ip')
      .set(RELAY_SECRET_HEADER, 'x'.repeat(40))
      .set(VISITOR_IP_HEADER, '203.0.113.7');
    expect(forged.body.ip).not.toBe('203.0.113.7');

    const malformed = await request(app)
      .get('/ip')
      .set(RELAY_SECRET_HEADER, SECRET)
      .set(VISITOR_IP_HEADER, 'pas-une-adresse');
    expect(malformed.body.ip).not.toBe('pas-une-adresse');
  });

  it('cannot be fooled by a made-up address: the limit still holds', async () => {
    const app = appWith({ limit: 1 });
    const first = await request(app)
      .get('/limited')
      .set('X-Forwarded-For', '198.51.100.1')
      .set(VISITOR_IP_HEADER, '198.51.100.1');
    expect(first.status).toBe(200);
    const second = await request(app)
      .get('/limited')
      .set('X-Forwarded-For', '198.51.100.2')
      .set(VISITOR_IP_HEADER, '198.51.100.2');
    expect(second.status).toBe(429);
  });

  it('keeps the routes of the site to the site when required', async () => {
    const closed = appWith({ required: true });
    const refused = await request(closed).get('/site-only');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('RELAY_REQUIRED');
    const relayed = await request(closed).get('/site-only').set(RELAY_SECRET_HEADER, SECRET);
    expect(relayed.status).toBe(200);
    expect((await request(appWith({ required: false })).get('/site-only')).status).toBe(200);
  });
});
