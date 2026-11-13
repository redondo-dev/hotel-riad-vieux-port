import { Router } from 'express';
import { z } from 'zod';
import { rateLimiter } from '../../../shared/http/rate-limit.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { ManageBooking } from '../application/manage-booking.ts';
import type { ManageLinkRequests } from '../application/manage-link-requests.ts';
import { MANAGE_TOKEN_PATTERN } from '../domain/manage-booking-rules.ts';

/**
 * « Gérer ma réservation » (step M), under /api/v1/public, called by the server of the public
 * site:
 *
 *   POST /bookings/manage          { reference, token }   the booking
 *   POST /bookings/manage/cancel   { reference, token }   cancelled at no cost, when allowed
 *   POST /bookings/manage/link     { reference, email }   « lien perdu »: always 202
 *
 * POST, the token in the body: never in an address, hence never in a log. 30 requests per
 * minute and per address: plenty for a customer, nothing against 256 random bits.
 */

export const MANAGE_LIMIT = { windowMs: 60_000, limit: 30 };
/** « Lien perdu »: 5 requests per hour and per address (each one may send an e-mail). */
export const LINK_REQUEST_LIMIT = { windowMs: 60 * 60_000, limit: 5 };

/** The same words whether the booking exists or not. */
export const LINK_REQUEST_ANSWER = {
  message:
    'Si cette réservation existe et correspond à cet e-mail, un nouveau lien vient d’y être ' +
    'envoyé.',
};

/** A malformed reference or token: refused before any reading of the database. */
const access = z.strictObject({
  reference: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/, { error: 'Lien non valide.' }),
  token: z.string().regex(MANAGE_TOKEN_PATTERN, { error: 'Lien non valide.' }),
});

const linkRequest = z.strictObject({
  reference: z.string().trim().toUpperCase().max(8),
  email: z.email({ error: 'Adresse e-mail invalide.' }).max(254),
});

export function manageBookingRouter(
  service: ManageBooking,
  linkRequests: ManageLinkRequests | undefined,
): Router {
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

  if (linkRequests !== undefined) {
    router.post(
      '/bookings/manage/link',
      rateLimiter(LINK_REQUEST_LIMIT),
      validated({ body: linkRequest }, ({ body }, _req, res) => {
        // Answered at once, before anything is looked up: the time taken tells nothing either.
        void linkRequests.request(body);
        res.set('Cache-Control', 'no-store');
        res.status(202).json(LINK_REQUEST_ANSWER);
      }),
    );
  }

  return router;
}
