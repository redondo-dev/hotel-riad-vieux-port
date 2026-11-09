import { type Request, Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/domain/errors.ts';
import { rateLimiter } from '../../../shared/http/rate-limit.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { OnlineBooking } from '../application/online-booking.ts';
import { RATE_PLANS } from '../domain/reservation-rules.ts';
import { parseGuests } from '../domain/stay-rules.ts';

/**
 * Bookings made on the website, under /api/v1/public (no session), called by the server of
 * the public site (step R-4):
 *
 *   POST /bookings     header Idempotency-Key required; answers the page of payment
 *
 * 5 bookings per 10 minutes and per address at most: a booking waiting for its payment holds
 * rooms, robots must not empty the hotel (decision « 4 » of step R-3).
 */

export const PUBLIC_BOOKING_LIMIT = { windowMs: 10 * 60_000, limit: 5 };

const isoDate = z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' });

function text(max: number) {
  return z.string().trim().min(1, { error: 'Champ obligatoire.' }).max(max);
}

const guests = z
  .string()
  .max(60)
  .transform((value, context) => {
    const rooms = parseGuests(value);
    if (typeof rooms === 'string') {
      context.addIssue({ code: 'custom', message: rooms });
      return z.NEVER;
    }
    return rooms;
  });

const newOnlineBooking = z.strictObject({
  checkIn: isoDate,
  checkOut: isoDate,
  guests,
  category: z.string().trim().min(1).max(60),
  ratePlan: z.enum(RATE_PLANS),
  customer: z.strictObject({
    firstName: text(100),
    lastName: text(100),
    email: z.email({ error: 'Adresse e-mail invalide.' }).max(254),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ().-]{6,30}$/, { error: 'Numéro de téléphone invalide.' }),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, { error: 'Code pays en deux lettres (FR).' })
      .nullable()
      .default(null),
  }),
  language: z.enum(['fr', 'en']),
  message: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
  /** The conditions of sale and cancellation, accepted by the visitor (box ticked). */
  acceptTerms: z.literal(true, { error: 'Acceptez les conditions de vente pour réserver.' }),
  successUrl: z.url().max(500),
  cancelUrl: z.url().max(500),
});

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** Each booking carries a key of its own: a double click or a retry books only once. */
function idempotencyKeyOf(req: Request): string {
  const key = req.get('Idempotency-Key');
  if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
    throw new ValidationError([
      {
        field: 'Idempotency-Key',
        message: 'En-tête obligatoire : 16 à 128 caractères (lettres, chiffres, - et _).',
      },
    ]);
  }
  return key;
}

export function publicBookingRouter(service: OnlineBooking): Router {
  const router = Router();

  router.post(
    '/bookings',
    rateLimiter(PUBLIC_BOOKING_LIMIT),
    validated({ body: newOnlineBooking }, async ({ body }, req, res) => {
      const key = idempotencyKeyOf(req);
      const { guests: rooms, acceptTerms: _accepted, ...rest } = body;
      const result = await service.create({ ...rest, rooms }, key, { ip: req.ip });
      res.set('Cache-Control', 'no-store');
      if (result.replayed) {
        res.set('Idempotent-Replayed', 'true');
      }
      res.status(201).json(result.answer);
    }),
  );

  return router;
}
