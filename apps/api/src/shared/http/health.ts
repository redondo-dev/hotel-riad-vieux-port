import { Router } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../domain/errors.ts';

/** Resolves when the database answers; rejects otherwise. */
export type DatabaseCheck = () => Promise<void>;

/** A database that does not answer within this delay is considered down. */
export const HEALTH_TIMEOUT_MS = 2_000;

function withTimeout(check: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`la base n’a pas répondu en ${ms} ms`));
    }, ms);
  });
  return Promise.race([check, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * GET /health (architecture, section 5): 200 when the API and the database answer, 503
 * otherwise. Used by the hosting and the monitoring. The answer never contains any internal
 * detail; the cause of a failure goes to the server log only.
 */
export function healthRouter(checkDatabase: DatabaseCheck, logger: Logger): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await withTimeout(checkDatabase(), HEALTH_TIMEOUT_MS);
    } catch (error) {
      logger.warn({ err: error }, 'contrôle de santé : base de données injoignable');
      throw new AppError({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        title: 'Service indisponible',
        detail: 'Le service est momentanément indisponible. Réessayez dans quelques instants.',
      });
    }
    res.json({ status: 'ok' });
  });
  return router;
}
