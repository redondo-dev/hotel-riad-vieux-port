import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import {
  type ReservationChanges,
  VersionRequiredError,
} from '../application/reservation-changes.ts';
import { versionOf } from '../domain/change-rules.ts';
import { BOOKING_ROLES, GUEST_LIMITS } from '../domain/stay-rules.ts';

/**
 * Changes of a reservation, under /api/v1/admin (staff session; management and reception):
 *
 *   PATCH /reservations/:id                         dates, guests, notes; If-Match: version;
 *                                                   ?preview=true gives the new price only
 *   GET   /reservations/:id/cancellation            fee of a cancellation made now
 *   POST  /reservations/:id/cancel                  cancel, with a reason
 *   GET   /reservations/:id/rooms/:lineId/free-rooms rooms the selector offers
 *   PUT   /reservations/:id/rooms/:lineId/room      give, change or take back the room
 *
 * The rights of the non-refundable rate (management only, RM-18) are checked by the service.
 */

const id = z.uuid({ error: 'Identifiant invalide.' });
const isoDate = z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' });

/** Left out: unchanged; empty or null: emptied. */
function editableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
}

const lineChange = z.strictObject({
  lineId: id,
  adults: z.int().min(GUEST_LIMITS.minAdults).max(GUEST_LIMITS.maxAdults),
  childrenAges: z
    .array(z.int().min(0).max(GUEST_LIMITS.maxChildAge))
    .max(GUEST_LIMITS.maxChildren)
    .default([]),
  babyCot: z.boolean().default(false),
});

const changes = z.strictObject({
  checkIn: isoDate.optional(),
  checkOut: isoDate.optional(),
  rooms: z.array(lineChange).min(1).max(GUEST_LIMITS.maxRooms).optional(),
  internalNotes: editableText(2000),
  customerMessage: editableText(500),
  reason: z.string().trim().min(1, { error: 'Motif obligatoire.' }).max(500).optional(),
});

const previewQuery = z.strictObject({
  preview: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const cancellation = z.strictObject({
  reason: z.string().trim().min(1, { error: 'Motif obligatoire.' }).max(500),
  waiveFee: z.boolean().default(false),
});

const assignment = z.strictObject({ roomId: id.nullable() });

const reservationParams = z.strictObject({ id });
const lineParams = z.strictObject({ id, lineId: id });

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

/** Staff data: never kept by a browser or a proxy cache. */
function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function reservationChangeRouter(
  service: ReservationChanges,
  requireStaff: RequestHandler,
): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...BOOKING_ROLES)];
  const writers = [...readers, requireCsrf];

  router.patch(
    '/reservations/:id',
    ...writers,
    validated(
      { params: reservationParams, query: previewQuery, body: changes },
      async ({ params, query, body }, req, res) => {
        const version = versionOf(req.get('If-Match'));
        if (version === undefined) {
          throw new VersionRequiredError();
        }
        const preview = query.preview ?? false;
        const origin = { ip: req.ip };
        noStore(res);
        res.json(await service.modify(actorOf(req), params.id, version, body, preview, origin));
      },
    ),
  );

  router.get(
    '/reservations/:id/cancellation',
    ...readers,
    validated({ params: reservationParams }, async ({ params }, _req, res) => {
      noStore(res);
      res.json(await service.cancellationQuote(params.id));
    }),
  );

  router.post(
    '/reservations/:id/cancel',
    ...writers,
    validated(
      { params: reservationParams, body: cancellation },
      async ({ params, body }, req, res) => {
        noStore(res);
        res.json(await service.cancel(actorOf(req), params.id, body, { ip: req.ip }));
      },
    ),
  );

  router.get(
    '/reservations/:id/rooms/:lineId/free-rooms',
    ...readers,
    validated({ params: lineParams }, async ({ params }, _req, res) => {
      noStore(res);
      res.json({ items: await service.freeRoomsFor(params.id, params.lineId) });
    }),
  );

  router.put(
    '/reservations/:id/rooms/:lineId/room',
    ...writers,
    validated({ params: lineParams, body: assignment }, async ({ params, body }, req, res) => {
      const origin = { ip: req.ip };
      const { id: reservationId, lineId } = params;
      noStore(res);
      res.json(await service.assignRoom(actorOf(req), reservationId, lineId, body.roomId, origin));
    }),
  );

  return router;
}
