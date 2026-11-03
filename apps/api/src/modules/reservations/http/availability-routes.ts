import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import { requireRole } from '../../identity/http/guards.ts';
import type { AvailabilityService } from '../application/availability-service.ts';
import { BOOKING_ROLES, parseGuests } from '../domain/stay-rules.ts';

/**
 * Availability for the staff, under /api/v1/admin (staff session; management and reception):
 *
 *   GET /availability?checkIn=2026-05-12&checkOut=2026-05-15&guests=2-6_2
 *
 * `guests` is written as in the addresses of the public site (see parseGuests). Read only:
 * nothing is held until the booking is created.
 */

const isoDate = z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' });

const stayQuery = z.strictObject({
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z
    .string()
    .max(60)
    .transform((text, context) => {
      const rooms = parseGuests(text);
      if (typeof rooms === 'string') {
        context.addIssue({ code: 'custom', message: rooms });
        return z.NEVER;
      }
      return rooms;
    }),
});

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function availabilityRouter(
  service: AvailabilityService,
  requireStaff: RequestHandler,
): Router {
  const router = Router();

  router.get(
    '/availability',
    requireStaff,
    requireRole(...BOOKING_ROLES),
    validated({ query: stayQuery }, async ({ query }, _req, res) => {
      res.set('Cache-Control', 'no-store');
      const { checkIn, checkOut, guests } = query;
      res.json(await service.search({ checkIn, checkOut, rooms: guests }));
    }),
  );

  return router;
}
