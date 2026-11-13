import { Router } from 'express';
import { z } from 'zod';
import { rateLimiter } from '../../../shared/http/rate-limit.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { ManageBooking } from '../application/manage-booking.ts';
import { MANAGE_TOKEN_PATTERN } from '../domain/manage-booking-rules.ts';

/**
 * « Gérer ma réservation » (step M), under /api/v1/public, called by the server of the public
 * site:
 *
 *   POST /bookings/manage          { reference, token }   the booking
 *   POST /bookings/manage/cancel   { reference, token }   cancelled at no cost, when allowed
 *
 * POST, the token in the body: never in an address, hence never in a log. 30 requests per
 * minute and per address: plenty for a customer, nothing against 256 random bits.
 */

export const MANAGE_LIMIT = { windowMs: 60_000, limit: 30 };

/** A malformed reference or token: refused before any reading of the database. */
const access = z.strictObject({
  reference: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/, { error: 'Lien non valide.' }),
  token: z.string().regex(MANAGE_TOKEN_PATTERN, { error: 'Lien non valide.' }),
});

export function manageBookingRouter(service: ManageBooking): Router {
  const router = Router();

  router.post(
    '/bookings/manage',
    rateLimiter(MANAGE_LIMIT),
    validated({ body: access }, async ({ body }, _req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await service.view(body));
    }),
  );

  router.post(
    '/bookings/manage/cancel',
    rateLimiter(MANAGE_LIMIT),
    validated({ body: access }, async ({ body }, _req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await service.cancel(body));
    }),
  );

  return router;
}
