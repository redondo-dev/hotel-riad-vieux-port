import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { validated } from '../../../shared/http/validate.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { requireCsrf, requireRole } from '../../identity/http/guards.ts';
import type { ActionOrigin, CatalogAdmin } from '../application/catalog-admin.ts';
import {
  AMENITY_CODES,
  CATALOG_READ_ROLES,
  CATALOG_WRITE_ROLES,
  MAX_ADJUSTMENT_PCT,
  MAX_PRICE_CENTS,
  PRICING_UNITS,
  RATE_PERIOD_KINDS,
  SALES_CLOSURE_ROLES,
} from '../domain/catalog-admin-rules.ts';

/**
 * Catalogue management, under /api/v1/admin/catalog (staff session required):
 *
 *   GET    /categories              list, inactive ones included        (management, reception)
 *   PATCH  /categories/:id          texts, prices, capacity, (de)activate          (management)
 *   GET    /rooms                   list; filters categoryId, floor, isActive (mgmt, reception)
 *   POST   /rooms                   add a room                                       (management)
 *   PATCH  /rooms/:id               number, floor, category, (de)activate           (management)
 *   GET    /rate-periods            current and future, ?includePast=true: all (mgmt, reception)
 *   POST   /rate-periods            add a season or an event                         (management)
 *   PATCH  /rate-periods/:id        change it                                       (management)
 *   DELETE /rate-periods/:id        delete it                                       (management)
 *   GET    /sales-closures          current and future                  (management, reception)
 *   POST   /sales-closures          close a category for some nights    (management, reception)
 *   DELETE /sales-closures/:id      reopen it                           (management, reception)
 *   GET    /services                list, inactive ones included        (management, reception)
 *   PATCH  /services/:id            name, price, VAT, online, (de)activate          (management)
 *
 * Nights are given as « firstNight » and « lastNight », both included.
 */

// --- Field rules ---

function text(max: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1, { error: 'Ce champ est obligatoire.' })
    .max(max, { error: `${max} caractères au maximum.` });
}

/** French AND English: a public page never stays empty in one of the languages. */
function localized(max: number): z.ZodObject<{ fr: z.ZodString; en: z.ZodString }> {
  return z.strictObject({ fr: text(max), en: text(max) });
}

function wholeNumber(min: number, max: number): z.ZodInt {
  return z
    .int({ error: 'Nombre entier attendu.' })
    .min(min, { error: `Valeur minimale : ${min}.` })
    .max(max, { error: `Valeur maximale : ${max}.` });
}

function cents(min: number): z.ZodInt {
  return wholeNumber(min, MAX_PRICE_CENTS);
}

/** At most two decimals, as stored by the database (numeric(…, 2)). */
function twoDecimals(min: number, max: number): z.ZodNumber {
  return z
    .number({ error: 'Nombre attendu.' })
    .min(min, { error: `Valeur minimale : ${min}.` })
    .max(max, { error: `Valeur maximale : ${max}.` })
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      error: 'Deux décimales au maximum.',
    });
}

const id = z.uuid({ error: 'Identifiant invalide.' });
const night = z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ.' });
const idParams = z.strictObject({ id });

const atLeastOneChange = {
  error: 'Aucune modification demandée.',
};

function hasChanges(body: object): boolean {
  return Object.values(body).some((value) => value !== undefined);
}

const categoryChanges = z
  .strictObject({
    name: localized(80).optional(),
    description: localized(1000).optional(),
    beds: localized(120).optional(),
    areaSqm: wholeNumber(1, 500).optional(),
    maxOccupancy: wholeNumber(1, 10).optional(),
    baseOccupancy: wholeNumber(1, 10).optional(),
    basePriceCents: cents(1).optional(),
    extraAdultCents: cents(0).optional(),
    extraChildCents: cents(0).optional(),
    amenities: z
      .array(z.enum(AMENITY_CODES, { error: 'Équipement inconnu.' }))
      .max(AMENITY_CODES.length)
      .transform((codes) => [...new Set(codes)])
      .optional(),
    sortOrder: wholeNumber(0, 999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, atLeastOneChange);

const roomNumber = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{1,10}$/, {
    error: 'De 1 à 10 caractères : chiffres, lettres sans accent et tirets.',
  });
const floor = wholeNumber(-5, 50);

const newRoom = z.strictObject({
  number: roomNumber,
  floor,
  categoryId: id,
  isActive: z.boolean().default(true),
});

const roomChanges = z
  .strictObject({
    number: roomNumber.optional(),
    floor: floor.optional(),
    categoryId: id.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, atLeastOneChange);

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

const roomFilter = z.strictObject({
  categoryId: id.optional(),
  floor: z.coerce.number().pipe(floor).optional(),
  isActive: booleanQuery.optional(),
});

const ratePeriodFields = {
  name: text(120),
  kind: z.enum(RATE_PERIOD_KINDS, { error: 'Type inconnu : « season » ou « event ».' }),
  firstNight: night,
  lastNight: night,
  adjustmentPct: twoDecimals(-100, MAX_ADJUSTMENT_PCT),
  /** null: every category. */
  categoryId: id.nullable(),
};

const newRatePeriod = z.strictObject(ratePeriodFields);

const ratePeriodChanges = z
  .strictObject({
    name: ratePeriodFields.name.optional(),
    kind: ratePeriodFields.kind.optional(),
    firstNight: night.optional(),
    lastNight: night.optional(),
    adjustmentPct: ratePeriodFields.adjustmentPct.optional(),
    categoryId: ratePeriodFields.categoryId.optional(),
  })
  .refine(hasChanges, atLeastOneChange);

const ratePeriodFilter = z.strictObject({ includePast: booleanQuery.optional() });

const newSalesClosure = z.strictObject({
  categoryId: id,
  firstNight: night,
  lastNight: night,
  reason: z
    .string()
    .trim()
    .max(300, { error: '300 caractères au maximum.' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
});

const serviceChanges = z
  .strictObject({
    name: localized(80).optional(),
    unitPriceCents: cents(0).optional(),
    pricingUnit: z.enum(PRICING_UNITS, { error: 'Unité de prix inconnue.' }).optional(),
    vatRate: twoDecimals(0, 100).optional(),
    bookableOnline: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, atLeastOneChange);

// --- Routes ---

function originOf(req: Request): ActionOrigin {
  return { ip: req.ip };
}

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
export function catalogAdminRouter(catalog: CatalogAdmin, requireStaff: RequestHandler): Router {
  const router = Router();
  const readers = [requireStaff, requireRole(...CATALOG_READ_ROLES)];
  const writers = [requireStaff, requireRole(...CATALOG_WRITE_ROLES), requireCsrf];
  const closers = [requireStaff, requireRole(...SALES_CLOSURE_ROLES), requireCsrf];

  // --- Categories ---

  router.get('/categories', ...readers, async (_req, res) => {
    noStore(res);
    res.json({ items: await catalog.listCategories() });
  });

  router.patch(
    '/categories/:id',
    ...writers,
    validated({ params: idParams, body: categoryChanges }, async ({ params, body }, req, res) => {
      noStore(res);
      res.json(await catalog.updateCategory(actorOf(req), params.id, body, originOf(req)));
    }),
  );

  // --- Rooms ---

  router.get(
    '/rooms',
    ...readers,
    validated({ query: roomFilter }, async ({ query }, _req, res) => {
      noStore(res);
      res.json({ items: await catalog.listRooms(query) });
    }),
  );

  router.post(
    '/rooms',
    ...writers,
    validated({ body: newRoom }, async ({ body }, req, res) => {
      noStore(res);
      res.status(201).json(await catalog.createRoom(actorOf(req), body, originOf(req)));
    }),
  );

  router.patch(
    '/rooms/:id',
    ...writers,
    validated({ params: idParams, body: roomChanges }, async ({ params, body }, req, res) => {
      noStore(res);
      res.json(await catalog.updateRoom(actorOf(req), params.id, body, originOf(req)));
    }),
  );

  // --- Rate periods ---

  router.get(
    '/rate-periods',
    ...readers,
    validated({ query: ratePeriodFilter }, async ({ query }, _req, res) => {
      noStore(res);
      res.json({ items: await catalog.listRatePeriods(query.includePast ?? false) });
    }),
  );

  router.post(
    '/rate-periods',
    ...writers,
    validated({ body: newRatePeriod }, async ({ body }, req, res) => {
      noStore(res);
      res.status(201).json(await catalog.createRatePeriod(actorOf(req), body, originOf(req)));
    }),
  );

  router.patch(
    '/rate-periods/:id',
    ...writers,
    validated({ params: idParams, body: ratePeriodChanges }, async ({ params, body }, req, res) => {
      noStore(res);
      res.json(await catalog.updateRatePeriod(actorOf(req), params.id, body, originOf(req)));
    }),
  );

  router.delete(
    '/rate-periods/:id',
    ...writers,
    validated({ params: idParams }, async ({ params }, req, res) => {
      await catalog.deleteRatePeriod(actorOf(req), params.id, originOf(req));
      res.status(204).end();
    }),
  );

  // --- Sales closures ---

  router.get('/sales-closures', ...readers, async (_req, res) => {
    noStore(res);
    res.json({ items: await catalog.listSalesClosures() });
  });

  router.post(
    '/sales-closures',
    ...closers,
    validated({ body: newSalesClosure }, async ({ body }, req, res) => {
      noStore(res);
      res.status(201).json(await catalog.createSalesClosure(actorOf(req), body, originOf(req)));
    }),
  );

  router.delete(
    '/sales-closures/:id',
    ...closers,
    validated({ params: idParams }, async ({ params }, req, res) => {
      await catalog.deleteSalesClosure(actorOf(req), params.id, originOf(req));
      res.status(204).end();
    }),
  );

  // --- Services ---

  router.get('/services', ...readers, async (_req, res) => {
    noStore(res);
    res.json({ items: await catalog.listServices() });
  });

  router.patch(
    '/services/:id',
    ...writers,
    validated({ params: idParams, body: serviceChanges }, async ({ params, body }, req, res) => {
      noStore(res);
      res.json(await catalog.updateService(actorOf(req), params.id, body, originOf(req)));
    }),
  );

  return router;
}
