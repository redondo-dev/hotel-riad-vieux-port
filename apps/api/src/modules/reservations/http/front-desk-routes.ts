import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { FrontDesk } from '../application/front-desk.ts';
import { VersionRequiredError } from '../application/reservation-changes.ts';
import { versionOf } from '../domain/change-rules.ts';
import { FRONT_DESK_ROLES } from '../domain/front-desk-rules.ts';

/**
 * The front desk, under /api/v1/admin (staff session; management and reception):
 *
 *   GET  /front-desk?date=2026-05-10        arrivals and departures of the day (today by default)
 *   POST /reservations/:id/check-in         arrival; If-Match: version
 *   POST /reservations/:id/check-out        departure; If-Match: version
 *   POST /reservations/:id/no-show          no-show (RM-17); If-Match: version
 */

const id = z.uuid({ error: 'Identifiant invalide.' });

const dayQuery = z.strictObject({
  date: z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' }).optional(),
});

const checkIn = z.strictObject({
  identityChecked: z.boolean().default(false),
  policeFormDone: z.boolean().default(false),
  acceptDirtyRoom: z.boolean().default(false),
});

/** No body expected; an empty object is accepted too. */
const nothing = z.strictObject({}).optional();
const reservationParams = z.strictObject({ id });

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

function versionRead(req: Request): number {
  const version = versionOf(req.get('If-Match'));
  if (version === undefined) {
    throw new VersionRequiredError();
  }
  return version;
}

/** Staff data: never kept by a browser or a proxy cache. */
function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function frontDeskRouter(
  service: FrontDesk,
  requireStaff: RequestHandler,
  today: () => string,
): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...FRONT_DESK_ROLES)];
  const writers = [...readers, requireCsrf];

  router.get(
    '/front-desk',
    ...readers,
    validated({ query: dayQuery }, async ({ query }, _req, res) => {
      noStore(res);
      res.json(await service.day(query.date ?? today()));
    }),
  );

  router.post(
    '/reservations/:id/check-in',
    ...writers,
    validated({ params: reservationParams, body: checkIn }, async ({ params, body }, req, res) => {
      const version = versionRead(req);
      noStore(res);
      res.json(await service.checkIn(actorOf(req), params.id, version, body, { ip: req.ip }));
    }),
  );

  router.post(
    '/reservations/:id/check-out',
    ...writers,
    validated({ params: reservationParams, body: nothing }, async ({ params }, req, res) => {
      const version = versionRead(req);
      noStore(res);
      res.json(await service.checkOut(actorOf(req), params.id, version, { ip: req.ip }));
    }),
  );

  router.post(
    '/reservations/:id/no-show',
    ...writers,
    validated({ params: reservationParams, body: nothing }, async ({ params }, req, res) => {
      const version = versionRead(req);
      noStore(res);
      res.json(await service.noShow(actorOf(req), params.id, version, { ip: req.ip }));
    }),
  );

  return router;
}
