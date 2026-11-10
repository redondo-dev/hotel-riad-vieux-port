import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Reservations taken by the staff against the test database: creation (prices frozen,
 * services, tourist tax, idempotency, capacity, closures, the last room asked twice at the
 * same moment), list and detail. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 4 (rooms B4xx), the categories « resa-… », the e-mails « resa-… » and
 * May 2034, with the current day fixed on 1 April 2034. It sets the hotel settings it needs and
 * puts the previous ones back at the end.
 */

const RESERVATIONS = `${ADMIN}/reservations`;
const TODAY = '2034-04-01';

type Session = Awaited<ReturnType<typeof logIn>>;

interface SavedSettings {
  discount: string;
  tax: number;
}

interface Detail {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  ratePlan: string;
  totalCents: number;
  freeCancellationUntil: string | null;
  version: number;
  customer: { id: string; email: string };
  rooms: { subtotalCents: number; room: unknown; nights: { priceCents: number }[] }[];
  charges: { kind: string; quantity: number; unitPriceCents: number; totalCents: number }[];
}

let keyCount = 0;

/** A new idempotency key for each request, unless the test reuses one on purpose. */
function newKey(): string {
  keyCount += 1;
  return `test-resa-${String(keyCount).padStart(8, '0')}`;
}

describe.skipIf(!hasTestDatabase)('reservations taken by the staff', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let reception: Session;
  let housekeeper: Session;
  let saved: SavedSettings | undefined;
  const ids: Record<string, string> = {};

  function create(body: object, key: string = newKey()): request.Test {
    return reception.agent
      .post(RESERVATIONS)
      .set('X-CSRF-Token', reception.csrfToken)
      .set('Idempotency-Key', key)
      .send(body);
  }

  /** 2 nights in May 2034, flexible rate, booked by phone for a new customer. */
  function booking(changes: object = {}): object {
    return {
      checkIn: '2034-05-10',
      checkOut: '2034-05-12',
      ratePlan: 'flexible',
      source: 'phone',
      rooms: [{ categoryId: ids['resa-famille'], adults: 2, childrenAges: [6] }],
      newCustomer: { firstName: 'Jeanne', lastName: 'Martin', email: 'resa-martin@test.example' },
      ...changes,
    };
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app({ today: () => TODAY });
    reception = await logIn(app, await harness.createStaff('reception'));
    housekeeper = await logIn(app, await harness.createStaff('housekeeping'));

    const settings = await harness.rows<SavedSettings>(
      `SELECT non_refundable_discount_pct::text AS discount,
              tourist_tax_cents_per_adult_night AS tax
         FROM hotel_settings WHERE id = 1`,
    );
    saved = settings[0];
    if (saved === undefined) {
      await harness.execute(
        `INSERT INTO hotel_settings (id, name, address, phone, email,
                                     non_refundable_discount_pct, tourist_tax_cents_per_adult_night)
         VALUES (1, 'Hôtel de test', '1 quai de test, 13002 Marseille', '+33465710000',
                 'contact@test.example', 10, 250)`,
      );
    } else {
      await harness.execute(
        `UPDATE hotel_settings
            SET non_refundable_discount_pct = 10, tourist_tax_cents_per_adult_night = 250
          WHERE id = 1`,
      );
    }

    const categories = await harness.rows<{ id: string; code: string }>(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents)
       VALUES ('resa-famille', 'Famille résa', 'Family', 'D', 'D', 'L', 'B', 25,
               3, 2, 10000, 2500, 1500),
              ('resa-double', 'Double résa', 'Double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500),
              ('resa-fermee', 'Fermée résa', 'Closed', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500)
       RETURNING id, code`,
    );
    for (const category of categories) {
      ids[category.code] = category.id;
    }
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 4, c.id
         FROM room_categories c
         JOIN (VALUES ('B401', 'resa-famille'), ('B402', 'resa-famille'),
                      ('B411', 'resa-double'), ('B421', 'resa-fermee')) AS v (number, code)
           ON v.code = c.code`,
    );
    await harness.execute(
      `INSERT INTO sales_closures (category_id, period, reason)
       VALUES ($1, daterange('2034-05-01', '2034-06-01', '[)'), 'Travaux')`,
      [ids['resa-fermee']],
    );
    const services = await harness.rows<{ id: string }>(
      `INSERT INTO services (code, name_fr, name_en, unit_price_cents, pricing_unit, vat_rate)
       VALUES ('resa-petit-dejeuner', 'Petit-déjeuner', 'Breakfast', 1400, 'per_person_night', 10)
       RETURNING id`,
    );
    ids['breakfast'] = services[0]?.id ?? '';
  });

  afterAll(async () => {
    if (saved === undefined) {
      await harness.execute('DELETE FROM hotel_settings WHERE id = 1');
    } else {
      await harness.execute(
        `UPDATE hotel_settings
            SET non_refundable_discount_pct = $1::numeric, tourist_tax_cents_per_adult_night = $2
          WHERE id = 1`,
        [saved.discount, saved.tax],
      );
    }
    await harness.close();
  });

  describe('access', () => {
    it('requires a staff session, the right role and the anti-CSRF token', async () => {
      expect((await request(app).get(RESERVATIONS)).status).toBe(401);
      expect((await housekeeper.agent.get(RESERVATIONS)).status).toBe(403);
      const withoutToken = await reception.agent
        .post(RESERVATIONS)
        .set('Idempotency-Key', newKey())
        .send(booking());
      expect(withoutToken.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('requires an idempotency key', async () => {
      const response = await reception.agent
        .post(RESERVATIONS)
        .set('X-CSRF-Token', reception.csrfToken)
        .send(booking());
      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('Idempotency-Key');
    });
  });

  describe('creation', () => {
    const key = newKey();
    let created: Detail;

    it('books for a new customer: nights frozen, breakfast and tourist tax apart', async () => {
      const response = await create(
        booking({ services: [{ serviceId: ids['breakfast'] }], internalNotes: 'Appel de 10 h' }),
        key,
      );
      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      created = response.body as Detail;

      expect(created.reference).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(created.status).toBe('confirmed');
      expect(created.paymentStatus).toBe('unpaid');
      expect(created.version).toBe(0);
      expect(created.customer.email).toBe('resa-martin@test.example');
      // 2 adults and a child of 6: one child supplement each night.
      expect(created.rooms[0]?.nights.map((night) => night.priceCents)).toEqual([11_500, 11_500]);
      expect(created.rooms[0]?.room).toBeNull();
      // Breakfast: 3 guests × 2 nights; tourist tax: 2 adults × 2 nights.
      expect(created.charges).toEqual([
        expect.objectContaining({ kind: 'service', quantity: 6, totalCents: 8400 }),
        expect.objectContaining({ kind: 'tourist_tax', quantity: 4, totalCents: 1000 }),
      ]);
      expect(created.totalCents).toBe(23_000 + 8400 + 1000);
      // 15:00 in Marseille on 10 May (summer time) is 13:00 UTC; 48 hours before.
      expect(created.freeCancellationUntil).toBe('2034-05-08T13:00:00.000Z');

      const audit = await harness.rows<{ action: string }>(
        'SELECT action FROM audit_logs WHERE entity_id = $1',
        [created.id],
      );
      expect(audit.map((row) => row.action)).toEqual(['reservation.created']);
    });

    it('answers the same request again without booking twice (idempotency)', async () => {
      const response = await create(
        booking({ services: [{ serviceId: ids['breakfast'] }], internalNotes: 'Appel de 10 h' }),
        key,
      );
      expect(response.status).toBe(201);
      expect(response.headers['idempotent-replayed']).toBe('true');
      expect(response.body.id).toBe(created.id);
      const count = await harness.rows<{ count: number }>(
        `SELECT count(*)::int AS count FROM customers WHERE email = 'resa-martin@test.example'`,
      );
      expect(count[0]?.count).toBe(1);
    });

    it('refuses the same key for a different request', async () => {
      const response = await create(booking({ checkOut: '2034-05-13' }), key);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('books the non-refundable rate for a known customer, no free cancellation', async () => {
      const response = await create(
        booking({
          ratePlan: 'non_refundable',
          checkIn: '2034-05-20',
          checkOut: '2034-05-22',
          rooms: [{ categoryId: ids['resa-famille'], adults: 2 }],
          newCustomer: undefined,
          customerId: created.customer.id,
        }),
      );
      expect(response.status).toBe(201);
      const detail = response.body as Detail;
      expect(detail.customer.id).toBe(created.customer.id);
      expect(detail.rooms[0]?.subtotalCents).toBe(2 * 9000);
      expect(detail.totalCents).toBe(18_000 + 1000);
      expect(detail.freeCancellationUntil).toBeNull();
    });
  });

  describe('refusals', () => {
    it('refuses more guests than the category holds (probe P1, RM-07)', async () => {
      const response = await create(
        booking({ rooms: [{ categoryId: ids['resa-famille'], adults: 2, childrenAges: [6, 8] }] }),
      );
      expect(response.status).toBe(400);
      expect(response.body.errors.map((error: { field: string }) => error.field)).toEqual([
        'rooms[0]',
      ]);
    });

    it('refuses a category closed to sale', async () => {
      const response = await create(
        booking({ rooms: [{ categoryId: ids['resa-fermee'], adults: 2 }] }),
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CATEGORY_CLOSED');
    });

    it('refuses an arrival in the past, and both customer kinds at once', async () => {
      const past = await create(booking({ checkIn: '2034-03-01', checkOut: '2034-03-02' }));
      expect(past.status).toBe(400);
      const both = await create(booking({ customerId: '00000000-0000-4000-8000-000000000000' }));
      expect(both.status).toBe(400);
      expect(both.body.errors[0].field).toBe('customerId');
    });

    it('gives the last room to one of two bookings made at the same moment (RM-03)', async () => {
      const last = booking({ rooms: [{ categoryId: ids['resa-double'], adults: 2 }] });
      const responses = await Promise.all([create(last), create(last)]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409]);
      const refused = responses.find((response) => response.status === 409);
      expect(refused?.body.code).toBe('NOT_AVAILABLE');
    });
  });

  describe('list and detail', () => {
    it('finds the reservations by name, from today by default, 25 per page', async () => {
      const response = await reception.agent.get(`${RESERVATIONS}?q=martin`);
      expect(response.status).toBe(200);
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(25);
      const items = response.body.items as { customer: { email: string }; checkIn: string }[];
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.every((item) => item.customer.email === 'resa-martin@test.example')).toBe(true);
      const arrivals = items.map((item) => item.checkIn);
      expect(arrivals).toEqual([...arrivals].sort());
    });

    it('filters the reservations without a room number and by arrival period', async () => {
      const query = 'unassigned=true&arrivalFrom=2034-05-10&arrivalTo=2034-05-10&source=phone';
      const response = await reception.agent.get(`${RESERVATIONS}?${query}`);
      expect(response.body.total).toBeGreaterThanOrEqual(1);
      const before = await reception.agent.get(`${RESERVATIONS}?arrivalTo=2034-04-30&q=martin`);
      expect(before.body.items).toEqual([]);
    });

    it('gives the detail, and 404 for an unknown reservation', async () => {
      const list = await reception.agent.get(`${RESERVATIONS}?q=martin`);
      const first = (list.body.items as { id: string }[])[0];
      const detail = await reception.agent.get(`${RESERVATIONS}/${first?.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.rooms[0].nights).toHaveLength(2);
      const unknown = await reception.agent.get(
        `${RESERVATIONS}/00000000-0000-4000-8000-000000000000`,
      );
      expect(unknown.status).toBe(404);
    });

    it('tells whether a card is saved as a guarantee, never its Stripe references', async () => {
      const list = await reception.agent.get(`${RESERVATIONS}?q=martin`);
      const first = (list.body.items as { id: string; cardGuarantee: boolean }[])[0];
      expect(first?.cardGuarantee).toBe(false);

      await harness.execute(
        `UPDATE reservations
            SET stripe_customer_id = 'cus_test_resa', stripe_payment_method_id = 'pm_test_resa'
          WHERE id = $1`,
        [first?.id],
      );

      const detail = await reception.agent.get(`${RESERVATIONS}/${first?.id}`);
      expect(detail.body.cardGuarantee).toBe(true);
      expect(JSON.stringify(detail.body)).not.toMatch(/pm_test|cus_test/);
      const again = await reception.agent.get(`${RESERVATIONS}?q=martin`);
      const items = again.body.items as { id: string; cardGuarantee: boolean }[];
      expect(items.find((item) => item.id === first?.id)?.cardGuarantee).toBe(true);
    });

    it('searches the customers by name or e-mail, from 2 characters', async () => {
      const response = await reception.agent.get(`${ADMIN}/customers?q=resa-mar`);
      expect(response.status).toBe(200);
      // Two customers « Martin »: the one booked first, and the winner of the race above.
      const emails = (response.body.items as { email: string }[]).map((item) => item.email);
      expect(emails.length).toBeGreaterThanOrEqual(1);
      expect(emails.every((email) => email === 'resa-martin@test.example')).toBe(true);
      expect((await reception.agent.get(`${ADMIN}/customers?q=m`)).status).toBe(400);
    });
  });
});
