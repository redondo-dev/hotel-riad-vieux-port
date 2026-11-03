import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import { requireRole } from '../../identity/http/guards.ts';
import type { PlanningService } from '../application/planning-service.ts';
import { PLANNING_ROLES } from '../domain/planning-rules.ts';

/**
 * The planning of the rooms, under /api/v1/admin (staff session; every role, read only):
 *
 *   GET /planning?from=2026-05-01&to=2026-05-14     both days included, 31 days at most
 *
 * The guests' names are left out for housekeeping and technicians.
 */

const isoDate = z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' });

const period = z.strictObject({ from: isoDate, to: isoDate });

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function planningRouter(service: PlanningService, requireStaff: RequestHandler): Router {
  const router = Router();

  router.get(
    '/planning',
    requireStaff,
    requireRole(...PLANNING_ROLES),
    validated({ query: period }, async ({ query }, req, res) => {
      const role = req.staffUser?.role;
      if (role === undefined) {
        throw new Error('requireStaff doit précéder cette route');
      }
      res.set('Cache-Control', 'no-store');
      res.json(await service.planning(query.from, query.to, role));
    }),
  );

  return router;
}
