import { Router } from 'express';
import { NotFoundError } from '../../../shared/domain/errors.ts';
import { DEMO_ACCOUNTS } from '../domain/demo-accounts.ts';

/**
 * GET /admin/demo — PORTFOLIO ONLY. When the demo is active (DEMO_MODE=true and
 * DEMO_USER_PASSWORD set), gives the demo accounts and their shared password, so that the login
 * page of the staff tool can display them. Otherwise answers 404, exactly like a route that does
 * not exist: a real hotel never exposes anything here.
 */
export function demoRouter(demoPassword: string | undefined): Router {
  const router = Router();
  router.get('/demo', (_req, res) => {
    if (demoPassword === undefined) {
      throw new NotFoundError('Aucune ressource ne correspond à cette adresse.');
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      password: demoPassword,
      accounts: DEMO_ACCOUNTS.map(({ email, firstName, lastName, role }) => ({
        email,
        firstName,
        lastName,
        role,
      })),
    });
  });
  return router;
}
