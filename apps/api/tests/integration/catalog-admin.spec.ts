import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Catalogue management against the test database: roles, CSRF, validation, conflicts and audit
 * log. Skipped without TEST_DATABASE_URL.
 *
 * Rooms: floor 8 (G8xx); references « GEST… ».
 * Dates: this file uses the years 2031–2032 (future) and 2020 (past), and only rate periods of
 * its own categories, so that it never collides with public-catalog.spec.ts (January–February
 * 2030, periods of every category).
 */

const CATALOG = `${ADMIN}/catalog`;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type Agent = ReturnType<typeof request.agent>;

interface Session {
  agent: Agent;
  csrfToken: string;
}

interface AuditRow {
  action: string;
  changes: Record<string, unknown>;
}

describe.skipIf(!hasTestDatabase)('catalogue management', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let manager: Session;
  let reception: Session;
  let housekeeping: Session;
  let categoryId: string;
  let otherCategoryId: string;
  let serviceId: string;

  async function insertCategory(code: string, sortOrder: number): Promise<string> {
    const rows = await harness.rows<{ id: string }>(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en,
         area_sqm, max_occupancy, base_occupancy, base_price_cents, sort_order)
       VALUES ($1, 'Nom', 'Name', 'Description', 'Description', '1 lit', '1 bed',
               20, 2, 2, 10000, $2)
       RETURNING id`,
      [code, sortOrder],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('catégorie non créée');
    }
    return id;
  }

  async function lastAudit(entityId: string): Promise<AuditRow | undefined> {
    const rows = await harness.rows<AuditRow>(
      'SELECT action, changes FROM audit_logs WHERE entity_id = $1 ORDER BY id DESC LIMIT 1',
      [entityId],
    );
    return rows[0];
  }

  function send(session: Session, method: 'post' | 'patch' | 'delete', path: string): request.Test {
    return session.agent[method](`${CATALOG}${path}`).set('X-CSRF-Token', session.csrfToken);
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app();
    manager = await logIn(app, await harness.createStaff('direction'));
    reception = await logIn(app, await harness.createStaff('reception'));
    housekeeping = await logIn(app, await harness.createStaff('housekeeping'));

    categoryId = await insertCategory('gestion-double', 10);
    otherCategoryId = await insertCategory('gestion-suite', 11);
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id, is_active) VALUES
         ('G801', 8, $1, true), ('G802', 8, $1, false)`,
      [categoryId],
    );
    const services = await harness.rows<{ id: string }>(
      `INSERT INTO services (code, name_fr, name_en, unit_price_cents, pricing_unit, vat_rate,
                             bookable_online)
       VALUES ('gestion-parking', 'Parking', 'Car park', 1500, 'per_night', 20, false)
       RETURNING id`,
    );
    serviceId = services[0]?.id ?? '';
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('access', () => {
    it('requires a staff session', async () => {
      const response = await request(app).get(`${CATALOG}/categories`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('is closed to housekeeping and technicians', async () => {
      const response = await housekeeping.agent.get(`${CATALOG}/categories`);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('lets the reception read but not change prices', async () => {
      expect((await reception.agent.get(`${CATALOG}/categories`)).status).toBe(200);
      const response = await send(reception, 'patch', `/categories/${categoryId}`).send({
        basePriceCents: 1,
      });
      expect(response.status).toBe(403);
    });

    it('refuses a change without the anti-CSRF token', async () => {
      const path = `${CATALOG}/categories/${categoryId}`;
      const response = await manager.agent.patch(path).send({ basePriceCents: 12_000 });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
    });
  });

  describe('categories', () => {
    it('lists every category with its room counts, never cached', async () => {
      const response = await manager.agent.get(`${CATALOG}/categories`);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const items = response.body.items as { id: string }[];
      const category = items.find((item) => item.id === categoryId);
      expect(category).toEqual({
        id: categoryId,
        code: 'gestion-double',
        name: { fr: 'Nom', en: 'Name' },
        description: { fr: 'Description', en: 'Description' },
        beds: { fr: '1 lit', en: '1 bed' },
        areaSqm: 20,
        maxOccupancy: 2,
        baseOccupancy: 2,
        basePriceCents: 10_000,
        extraAdultCents: 2500,
        extraChildCents: 1500,
        amenities: [],
        sortOrder: 10,
        isActive: true,
        roomCount: 2,
        activeRoomCount: 1,
      });
    });

    it('changes texts and prices, and writes before → after in the audit log', async () => {
      const response = await send(manager, 'patch', `/categories/${categoryId}`).send({
        name: { fr: '  Double vue mer ', en: 'Sea view double' },
        basePriceCents: 11_000,
        amenities: ['wifi', 'port-view', 'wifi'],
      });

      expect(response.status).toBe(200);
      expect(response.body.name).toEqual({ fr: 'Double vue mer', en: 'Sea view double' });
      expect(response.body.basePriceCents).toBe(11_000);
      expect(response.body.amenities).toEqual(['wifi', 'port-view']);
      // The code never changes: it is part of the public addresses.
      expect(response.body.code).toBe('gestion-double');

      const audit = await lastAudit(categoryId);
      expect(audit?.action).toBe('category.updated');
      expect(audit?.changes['basePriceCents']).toEqual({ from: 10_000, to: 11_000 });
      const changedFields = Object.keys(audit?.changes ?? {}).sort();
      expect(changedFields).toEqual(['amenities', 'basePriceCents', 'name']);
    });

    it('refuses an empty English text, an unknown field or the code', async () => {
      const response = await send(manager, 'patch', `/categories/${categoryId}`).send({
        name: { fr: 'Double', en: ' ' },
        code: 'autre-code',
      });
      expect(response.status).toBe(400);
      const fields = (response.body.errors as { field: string }[]).map((error) => error.field);
      expect(fields).toContain('name.en');
      expect(fields).toContain('body');
    });

    it('refuses more guests included than the capacity', async () => {
      const response = await send(manager, 'patch', `/categories/${categoryId}`).send({
        baseOccupancy: 3,
      });
      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'baseOccupancy',
          message: 'Le nombre de personnes comprises ne peut pas dépasser la capacité.',
        },
      ]);
    });

    it('deactivates and reactivates a category', async () => {
      const off = await send(manager, 'patch', `/categories/${otherCategoryId}`).send({
        isActive: false,
      });
      expect(off.body.isActive).toBe(false);
      expect((await lastAudit(otherCategoryId))?.action).toBe('category.deactivated');

      await send(manager, 'patch', `/categories/${otherCategoryId}`).send({ isActive: true });
      expect((await lastAudit(otherCategoryId))?.action).toBe('category.reactivated');
    });

    it('answers 404 for an unknown category', async () => {
      const response = await send(manager, 'patch', `/categories/${UNKNOWN_ID}`).send({
        sortOrder: 1,
      });
      expect(response.status).toBe(404);
    });
  });

  describe('rooms', () => {
    let roomId: string;

    it('adds a room', async () => {
      const response = await send(manager, 'post', '/rooms').send({
        number: 'G803',
        floor: 8,
        categoryId,
      });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: response.body.id,
        number: 'G803',
        floor: 8,
        categoryId,
        categoryCode: 'gestion-double',
        categoryName: 'Double vue mer',
        housekeepingStatus: 'clean',
        isActive: true,
        outOfService: false,
      });
      roomId = String(response.body.id);
      expect((await lastAudit(roomId))?.action).toBe('room.created');
    });

    it('refuses a number already used, with a clear message', async () => {
      const response = await send(manager, 'post', '/rooms').send({
        number: 'G801',
        floor: 8,
        categoryId,
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ROOM_NUMBER_TAKEN');
    });

    it('refuses an unknown category', async () => {
      const response = await send(manager, 'post', '/rooms').send({
        number: 'G899',
        floor: 8,
        categoryId: UNKNOWN_ID,
      });
      expect(response.status).toBe(400);
      const unknown = { field: 'categoryId', message: 'Catégorie inconnue.' };
      expect(response.body.errors).toEqual([unknown]);
    });

    it('filters the list by category and state', async () => {
      const query = `categoryId=${categoryId}&isActive=true`;
      const response = await reception.agent.get(`${CATALOG}/rooms?${query}`);
      expect(response.status).toBe(200);
      const rooms = response.body.items as { number: string }[];
      expect(rooms.map((room) => room.number)).toEqual(['G801', 'G803']);
    });

    it('marks out of service a room blocked today, not one blocked in the past', async () => {
      await harness.execute(
        `INSERT INTO room_blocks (room_id, period, reason)
         SELECT id, daterange('2020-01-01', NULL, '[)'), 'maintenance' FROM rooms
          WHERE number = 'G801'
         UNION ALL
         SELECT id, daterange('2020-01-01', '2020-01-05', '[)'), 'maintenance' FROM rooms
          WHERE number = 'G802'`,
      );
      // Released on the day it started: the period still covers today, the room is back on sale.
      await harness.execute(
        `INSERT INTO room_blocks (room_id, period, reason, released_at)
         SELECT id, daterange(current_date - 1, current_date + 2, '[)'), 'maintenance', now()
           FROM rooms WHERE number = 'G803'`,
      );
      const response = await reception.agent.get(`${CATALOG}/rooms?categoryId=${categoryId}`);
      const rooms = response.body.items as { number: string; outOfService: boolean }[];
      const states = rooms.map((room) => [room.number, room.outOfService]);
      expect(states).toEqual([
        ['G801', true],
        ['G802', false],
        ['G803', false],
      ]);
    });

    it('moves a room to another category, then deactivates it', async () => {
      const moved = await send(manager, 'patch', `/rooms/${roomId}`).send({
        categoryId: otherCategoryId,
      });
      expect(moved.status).toBe(200);
      expect(moved.body.categoryCode).toBe('gestion-suite');

      const off = await send(manager, 'patch', `/rooms/${roomId}`).send({ isActive: false });
      expect(off.body.isActive).toBe(false);
      expect((await lastAudit(roomId))?.action).toBe('room.deactivated');
    });

    it('offers no way to delete a room', async () => {
      const response = await send(manager, 'delete', `/rooms/${roomId}`);
      expect(response.status).toBe(404);
    });
  });

  describe('rooms and categories holding stays', () => {
    let bookedCategory: string;
    let bookedRoom: string;
    let pastRoom: string;

    beforeAll(async () => {
      bookedCategory = await insertCategory('gestion-reservee', 12);
      const rooms = await harness.rows<{ id: string; number: string }>(
        `INSERT INTO rooms (number, floor, category_id) VALUES
           ('G811', 8, $1), ('G812', 8, $1)
         RETURNING id, number`,
        [bookedCategory],
      );
      bookedRoom = rooms.find((room) => room.number === 'G811')?.id ?? '';
      pastRoom = rooms.find((room) => room.number === 'G812')?.id ?? '';
      await harness.execute(
        `INSERT INTO customers (first_name, last_name, email)
         VALUES ('Lina', 'Gestion', 'gest-lina@test.example')`,
      );
      // A stay to come on G811; a stay over long ago on G812.
      await harness.execute(
        `INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                                   rate_plan, total_amount_cents, free_cancellation_until)
         SELECT v.reference, c.id, 'desk', v.check_in::date, v.check_out::date, v.status,
                'flexible', 0, '2020-01-01T00:00:00Z'
           FROM customers c,
                (VALUES ('GEST0001', '2031-03-10', '2031-03-12', 'confirmed'),
                        ('GEST0002', '2020-03-10', '2020-03-12', 'checked_out'))
                  AS v (reference, check_in, check_out, status)
          WHERE c.email = 'gest-lina@test.example'`,
      );
      await harness.execute(
        `INSERT INTO reservation_rooms (reservation_id, category_id, room_id, adults,
                                        subtotal_cents)
         SELECT r.id, $1, CASE WHEN r.reference = 'GEST0001' THEN $2::uuid ELSE $3::uuid END,
                2, 0
           FROM reservations r
          WHERE r.reference IN ('GEST0001', 'GEST0002')`,
        [bookedCategory, bookedRoom, pastRoom],
      );
    });

    it('refuses to deactivate or move a room given to a stay to come', async () => {
      const off = await send(manager, 'patch', `/rooms/${bookedRoom}`).send({ isActive: false });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('ROOM_HAS_STAYS');
      expect(off.body.detail).toContain('GEST0001');

      const moved = await send(manager, 'patch', `/rooms/${bookedRoom}`).send({
        categoryId: otherCategoryId,
      });
      expect(moved.body.code).toBe('ROOM_HAS_STAYS');

      // A stay over does not hold the room any more.
      const past = await send(manager, 'patch', `/rooms/${pastRoom}`).send({ isActive: false });
      expect(past.status).toBe(200);
    });

    it('refuses to deactivate a category booked for a stay to come', async () => {
      const off = await send(manager, 'patch', `/categories/${bookedCategory}`).send({
        isActive: false,
      });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('CATEGORY_HAS_STAYS');
      expect(off.body.detail).toContain('GEST0001');
    });
  });

  describe('rate periods', () => {
    let periodId: string;

    it('adds an event, nights given first and last included', async () => {
      const response = await send(manager, 'post', '/rate-periods').send({
        name: 'Festival 2031',
        kind: 'event',
        firstNight: '2031-07-10',
        lastNight: '2031-07-12',
        adjustmentPct: 35.5,
        categoryId,
      });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: response.body.id,
        name: 'Festival 2031',
        kind: 'event',
        firstNight: '2031-07-10',
        lastNight: '2031-07-12',
        adjustmentPct: 35.5,
        categoryId,
        categoryCode: 'gestion-double',
      });
      periodId = String(response.body.id);

      // Stored as [first night, day after the last night).
      const rows = await harness.rows<{ period: string }>(
        'SELECT period::text AS period FROM rate_periods WHERE id = $1',
        [periodId],
      );
      expect(rows[0]?.period).toBe('[2031-07-10,2031-07-13)');
    });

    it('refuses a second event of the same category on one of these nights', async () => {
      const response = await send(manager, 'post', '/rate-periods').send({
        name: 'Autre événement',
        kind: 'event',
        firstNight: '2031-07-12',
        lastNight: '2031-07-15',
        adjustmentPct: 10,
        categoryId,
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('RATE_PERIOD_OVERLAP');
    });

    it('accepts a season on the same nights (an event wins over a season)', async () => {
      const response = await send(manager, 'post', '/rate-periods').send({
        name: 'Été 2031',
        kind: 'season',
        firstNight: '2031-06-01',
        lastNight: '2031-08-31',
        adjustmentPct: 20,
        categoryId,
      });
      expect(response.status).toBe(201);
    });

    it('refuses a last night before the first one, and three decimals', async () => {
      const response = await send(manager, 'post', '/rate-periods').send({
        name: 'Erreur',
        kind: 'season',
        firstNight: '2031-12-10',
        lastNight: '2031-12-01',
        adjustmentPct: 10,
        categoryId,
      });
      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('lastNight');

      const decimals = await send(manager, 'post', '/rate-periods').send({
        name: 'Erreur',
        kind: 'season',
        firstNight: '2031-12-01',
        lastNight: '2031-12-10',
        adjustmentPct: 10.125,
        categoryId,
      });
      expect(decimals.status).toBe(400);
      expect(decimals.body.errors[0].field).toBe('adjustmentPct');
    });

    it('changes then deletes a period, both written to the audit log', async () => {
      const changed = await send(manager, 'patch', `/rate-periods/${periodId}`).send({
        adjustmentPct: 40,
      });
      expect(changed.status).toBe(200);
      expect(changed.body.adjustmentPct).toBe(40);

      expect((await send(manager, 'delete', `/rate-periods/${periodId}`)).status).toBe(204);
      const audit = await lastAudit(periodId);
      expect(audit?.action).toBe('rate_period.deleted');
      expect(audit?.changes['adjustmentPct']).toBe(40);

      expect((await send(manager, 'delete', `/rate-periods/${periodId}`)).status).toBe(404);
    });

    it('lists current and future periods, past ones on request', async () => {
      await send(manager, 'post', '/rate-periods').send({
        name: 'Saison 2020',
        kind: 'season',
        firstNight: '2020-04-01',
        lastNight: '2020-09-30',
        adjustmentPct: 15,
        categoryId: otherCategoryId,
      });
      const names = async (query: string): Promise<string[]> => {
        const response = await reception.agent.get(`${CATALOG}/rate-periods${query}`);
        return (response.body.items as { name: string }[]).map((period) => period.name);
      };
      expect(await names('')).not.toContain('Saison 2020');
      expect(await names('?includePast=true')).toContain('Saison 2020');
    });
  });

  describe('sales closures', () => {
    it('lets the reception close then reopen a category', async () => {
      const created = await send(reception, 'post', '/sales-closures').send({
        categoryId,
        firstNight: '2032-03-01',
        lastNight: '2032-03-03',
        reason: 'Groupe Congrès',
      });
      expect(created.status).toBe(201);
      expect(created.body.firstNight).toBe('2032-03-01');
      expect(created.body.lastNight).toBe('2032-03-03');
      expect(created.body.createdBy).toEqual({ firstName: 'Test', lastName: 'reception' });

      const list = await reception.agent.get(`${CATALOG}/sales-closures`);
      const closures = list.body.items as { id: string }[];
      expect(closures.map((item) => item.id)).toContain(created.body.id);

      const closureId = String(created.body.id);
      expect((await send(reception, 'delete', `/sales-closures/${closureId}`)).status).toBe(204);
      expect((await lastAudit(closureId))?.action).toBe('sales_closure.deleted');
    });

    it('refuses a closure in the past', async () => {
      const response = await send(manager, 'post', '/sales-closures').send({
        categoryId,
        firstNight: '2020-03-01',
        lastNight: '2020-03-03',
      });
      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('lastNight');
    });

    it('stays closed to housekeeping', async () => {
      const response = await send(housekeeping, 'post', '/sales-closures').send({
        categoryId,
        firstNight: '2032-04-01',
        lastNight: '2032-04-01',
      });
      expect(response.status).toBe(403);
    });
  });

  describe('services', () => {
    it('changes the price, the VAT and online booking', async () => {
      const response = await send(manager, 'patch', `/services/${serviceId}`).send({
        unitPriceCents: 1800,
        vatRate: 5.5,
        bookableOnline: true,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: serviceId,
        code: 'gestion-parking',
        name: { fr: 'Parking', en: 'Car park' },
        unitPriceCents: 1800,
        pricingUnit: 'per_night',
        vatRate: 5.5,
        bookableOnline: true,
        isActive: true,
      });
      const audit = await lastAudit(serviceId);
      expect(audit?.changes['vatRate']).toEqual({ from: 20, to: 5.5 });
    });

    it('refuses a VAT rate above 100 %', async () => {
      const response = await send(manager, 'patch', `/services/${serviceId}`).send({
        vatRate: 120,
      });
      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('vatRate');
    });
  });
});
