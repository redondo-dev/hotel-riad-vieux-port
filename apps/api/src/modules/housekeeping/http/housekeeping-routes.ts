import { type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../../shared/domain/errors.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { HousekeepingService } from '../application/housekeeping-service.ts';
import {
  HOUSEKEEPING_READ_ROLES,
  HOUSEKEEPING_STATUSES,
  MAX_ROOMS_PER_CHANGE,
} from '../domain/housekeeping-rules.ts';

/**
 * Housekeeping, under /api/v1/admin/housekeeping (staff session required; management,
 * reception and housekeeping):
 *
 *   GET   /rooms          active rooms and their state; filters floor and status
 *   PATCH /rooms/:id      change the state of one room
 *   POST  /rooms/status   change the state of several rooms at once (all or nothing)
 *
 * Who may set which state is checked by the service (the reception only « dirty »).
 */

const status = z.enum(HOUSEKEEPING_STATUSES, {
  error: 'État inconnu : « clean » (propre) ou « dirty » (à nettoyer).',
});

const roomId = z.uuid({ error: 'Identifiant invalide.' });

const boardFilter = z.strictObject({
  floor: z.coerce.number().pipe(z.int().min(-5).max(50)).optional(),
  status: status.optional(),
});

const idParams = z.strictObject({ id: roomId });
const oneChange = z.strictObject({ status });
const groupChange = z.strictObject({
  roomIds: z
    .array(roomId)
    .min(1, { error: 'Choisissez au moins une chambre.' })
    .max(MAX_ROOMS_PER_CHANGE, { error: `${MAX_ROOMS_PER_CHANGE} chambres au maximum.` }),
  status,
});

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function housekeepingRouter(
  service: HousekeepingService,
  requireStaff: RequestHandler,
): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...HOUSEKEEPING_READ_ROLES)];
  const writers = [...readers, requireCsrf];

  router.get(
    '/rooms',
    ...readers,
    validated({ query: boardFilter }, async ({ query }, _req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await service.board(query));
    }),
  );

  router.patch(
    '/rooms/:id',
    ...writers,
    validated({ params: idParams, body: oneChange }, async ({ params, body }, req, res) => {
      const origin = { ip: req.ip };
      const result = await service.changeStatus(actorOf(req), [params.id], body.status, origin);
      const room = result.items[0];
      if (room === undefined) {
        throw new NotFoundError('Cette chambre n’existe pas.');
      }
      res.set('Cache-Control', 'no-store');
      res.json(room);
    }),
  );

  router.post(
    '/rooms/status',
    ...writers,
    validated({ body: groupChange }, async ({ body }, req, res) => {
      const origin = { ip: req.ip };
      const result = await service.changeStatus(actorOf(req), body.roomIds, body.status, origin);
      res.set('Cache-Control', 'no-store');
      res.json(result);
    }),
  );

  return router;
}
