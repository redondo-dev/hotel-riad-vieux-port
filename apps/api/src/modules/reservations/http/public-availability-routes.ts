import { Router } from 'express';
import { z } from 'zod';
import { rateLimiter } from '../../../shared/http/rate-limit.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { PublicAvailability } from '../application/public-availability.ts';
import { parseGuests } from '../domain/stay-rules.ts';

/**
 * Availability for visitors, under /api/v1/public (no session, no personal data):
 *
 *   GET /availability?checkIn=2026-05-12&checkOut=2026-05-15&guests=2-6_2
 *
 * Called by the server of the public site, which passes on the visitor's address: the limit
 * of 30 searches per minute counts each visitor, not the site (TRUST_PROXY).
 */

/** Against robots that would read the stock night after night. */
export const PUBLIC_SEARCH_LIMIT = { windowMs: 60_000, limit: 30 };

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

export function publicSearchRouter(service: PublicAvailability): Router {
  const router = Router();

  router.get(
    '/availability',
    rateLimiter(PUBLIC_SEARCH_LIMIT),
    validated({ query: stayQuery }, async ({ query }, _req, res) => {
      // Prices and rooms left change with every booking: never kept by a cache.
      res.set('Cache-Control', 'no-store');
      const { checkIn, checkOut, guests } = query;
      res.json(await service.search({ checkIn, checkOut, rooms: guests }));
    }),
  );

  return router;
}
