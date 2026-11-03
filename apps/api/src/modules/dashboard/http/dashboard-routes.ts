import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import { requireRole } from '../../identity/http/guards.ts';
import type { DashboardService } from '../application/dashboard-service.ts';
import { DASHBOARD_ROLES } from '../domain/dashboard-rules.ts';

/**
 * The dashboard, under /api/v1/admin (staff session; management only):
 *
 *   GET /dashboard?date=2026-11-03        figures of the day and of its month (today by default)
 */

const dayQuery = z.strictObject({
  date: z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' }).optional(),
});

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function dashboardRouter(
  service: DashboardService,
  requireStaff: RequestHandler,
  today: () => string,
): Router {
  const router = Router();

  router.get(
    '/dashboard',
    requireStaff,
    requireRole(...DASHBOARD_ROLES),
    validated({ query: dayQuery }, async ({ query }, _req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await service.dashboard(query.date ?? today()));
    }),
  );

  return router;
}
