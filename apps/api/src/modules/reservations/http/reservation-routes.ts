import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/domain/errors.ts';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { NewBooking, ReservationService } from '../application/reservation-service.ts';
import {
  ALL_SOURCES,
  BOOKING_SOURCES,
  PAYMENT_STATUSES,
  RATE_PLANS,
  RESERVATION_STATUSES,
} from '../domain/reservation-rules.ts';
import { BOOKING_ROLES, GUEST_LIMITS } from '../domain/stay-rules.ts';

/**
 * Reservations taken by the staff, under /api/v1/admin (staff session; management and
 * reception):
 *
 *   POST /reservations          create (phone or desk); header Idempotency-Key required
 *   GET  /reservations          list: search, filters, 25 per page
 *   GET  /reservations/:id      detail: customer, rooms, nights, charges, version
 *   GET  /customers?q=          customers whose name or e-mail contains q (booking form)
 */

const PAGE_SIZE = 25;

const id = z.uuid({ error: 'Identifiant invalide.' });
const isoDate = z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' });

function text(max: number) {
  return z.string().trim().min(1, { error: 'Champ obligatoire.' }).max(max);
}

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null);
}

const room = z.strictObject({
  categoryId: id,
  adults: z.int().min(GUEST_LIMITS.minAdults).max(GUEST_LIMITS.maxAdults),
  childrenAges: z
    .array(z.int().min(0).max(GUEST_LIMITS.maxChildAge))
    .max(GUEST_LIMITS.maxChildren)
    .default([]),
  babyCot: z.boolean().default(false),
});

const service = z.strictObject({
  serviceId: id,
  quantity: z.int().min(1).max(99).default(1),
});

const newCustomer = z.strictObject({
  firstName: text(100),
  lastName: text(100),
  email: z.email({ error: 'Adresse e-mail invalide.' }).max(254),
  phone: optionalText(30),
  preferredLanguage: z.enum(['fr', 'en']).default('fr'),
});

const newBooking = z
  .strictObject({
    checkIn: isoDate,
    checkOut: isoDate,
    ratePlan: z.enum(RATE_PLANS),
    source: z.enum(BOOKING_SOURCES),
    rooms: z.array(room).min(1, { error: 'Au moins une chambre.' }).max(GUEST_LIMITS.maxRooms),
    services: z.array(service).max(10).default([]),
    customerId: id.optional(),
    newCustomer: newCustomer.optional(),
    customerMessage: optionalText(500),
    internalNotes: optionalText(2000),
  })
  .superRefine((body, context) => {
    if ((body.customerId === undefined) === (body.newCustomer === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Choisissez un client existant ou saisissez un nouveau client.',
      });
    }
    const serviceIds = body.services.map((item) => item.serviceId);
    if (new Set(serviceIds).size !== serviceIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['services'],
        message: 'Chaque prestation une seule fois : réglez plutôt sa quantité.',
      });
    }
  });

const listFilter = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  source: z.enum(ALL_SOURCES).optional(),
  arrivalFrom: isoDate.optional(),
  arrivalTo: isoDate.optional(),
  unassigned: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(['checkIn', 'created', 'total']).default('checkIn'),
  page: z.coerce.number().pipe(z.int().min(1).max(10_000)).default(1),
});

const customerQuery = z.strictObject({
  q: z.string().trim().min(2, { error: 'Au moins 2 caractères.' }).max(100),
});

const idParams = z.strictObject({ id });

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

function actorOf(req: Request): StaffUser {
  const user = req.staffUser;
  if (user === undefined) {
    throw new Error('requireStaff doit précéder cette route');
  }
  return user;
}

/** Each creation carries a key of its own: a double click or a retry creates nothing more. */
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

/** Staff data: never kept by a browser or a proxy cache. */
function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

/** `requireStaff` comes from the staff part of the API, which owns the sessions. */
export function reservationRouter(
  service: ReservationService,
  requireStaff: RequestHandler,
): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...BOOKING_ROLES)];
  const writers = [...readers, requireCsrf];

  router.post(
    '/reservations',
    ...writers,
    validated({ body: newBooking }, async ({ body }, req, res) => {
      const key = idempotencyKeyOf(req);
      const { customerId, newCustomer: fresh, ...stay } = body;
      let customer: NewBooking['customer'];
      if (customerId !== undefined) {
        customer = { id: customerId };
      } else if (fresh !== undefined) {
        customer = fresh;
      } else {
        throw new Error('client vérifié par le schéma');
      }
      const booking: NewBooking = { ...stay, customer };
      const result = await service.create(actorOf(req), booking, key, { ip: req.ip });
      noStore(res);
      if (result.replayed) {
        res.set('Idempotent-Replayed', 'true');
      }
      res.status(result.status).json(result.reservation);
    }),
  );

  router.get(
    '/reservations',
    ...readers,
    validated({ query: listFilter }, async ({ query }, _req, res) => {
      noStore(res);
      const page = await service.list({
        ...query,
        unassigned: query.unassigned ?? false,
        pageSize: PAGE_SIZE,
      });
      res.json({ ...page, page: query.page, pageSize: PAGE_SIZE });
    }),
  );

  router.get(
    '/reservations/:id',
    ...readers,
    validated({ params: idParams }, async ({ params }, _req, res) => {
      noStore(res);
      res.json(await service.detail(params.id));
    }),
  );

  router.get(
    '/customers',
    ...readers,
    validated({ query: customerQuery }, async ({ query }, _req, res) => {
      noStore(res);
      res.json({ items: await service.searchCustomers(query.q) });
    }),
  );

  return router;
}
