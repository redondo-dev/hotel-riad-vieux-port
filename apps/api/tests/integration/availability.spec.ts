import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Availability and prices for the staff against the test database: rooms taken out, released
 * blocks, booked and cancelled stays, sales closures, rate periods, capacity. Skipped without
 * TEST_DATABASE_URL.
 *
 * This file owns floor 5 (rooms D5xx), the categories « dispo-… » and the year 2034, with the
 * current day fixed on 1 April 2034. It sets the hotel settings it needs and puts the previous
 * ones back at the end.
 */

const AVAILABILITY = `${ADMIN}/availability`;
const TODAY = '2034-04-01';
const STAY = 'checkIn=2034-04-30&checkOut=2034-05-03';

interface Offer {
  fits: boolean;
  flexibleCents?: number;
  nonRefundableCents?: number;
  touristTaxCents?: number;
  nights?: { night: string; adjustmentPct: number; flexibleCents: number }[];
}

interface Category {
  code: string;
  freeRooms: number;
  freeRoomsByNight: { night: string; free: number }[];
  closed: boolean;
  offers: Offer[];
}

interface SavedSettings {
  discount: string;
  tax: number;
}

describe.skipIf(!hasTestDatabase)('availability for the staff', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let reception: Awaited<ReturnType<typeof logIn>>;
  let housekeeper: Awaited<ReturnType<typeof logIn>>;
  let saved: SavedSettings | undefined;

  async function search(query: string): Promise<request.Response> {
    return reception.agent.get(`${AVAILABILITY}?${query}`);
  }

  function category(response: request.Response, code: string): Category {
    const found = (response.body.categories as Category[]).find((item) => item.code === code);
    if (found === undefined) {
      throw new Error(`catégorie ${code} absente de la réponse`);
    }
    return found;
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

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents,
         sort_order)
       VALUES ('dispo-famille', 'Famille dispo', 'Family', 'D', 'D', 'L', 'B', 25,
               3, 2, 10000, 2500, 1500, 1),
              ('dispo-double', 'Double dispo', 'Double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 2)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id, is_active)
       SELECT v.number, 5, c.id, v.active
         FROM room_categories c
         JOIN (VALUES ('D501', 'dispo-famille', true), ('D502', 'dispo-famille', true),
                      ('D503', 'dispo-famille', true), ('D504', 'dispo-famille', false),
                      ('D511', 'dispo-double', true)) AS v (number, code, active)
           ON v.code = c.code`,
    );
    // D501 out of service from 2 May; D502 blocked on 1 May but released (back on sale).
    await harness.execute(
      `INSERT INTO room_blocks (room_id, period, reason, released_at)
       SELECT id, daterange('2034-05-02', NULL, '[)'), 'maintenance', NULL::timestamptz
         FROM rooms WHERE number = 'D501'
       UNION ALL
       SELECT id, daterange('2034-05-01', '2034-05-02', '[)'), 'maintenance', now()
         FROM rooms WHERE number = 'D502'`,
    );
    // One stay booked on the nights of 1 and 2 May, one cancelled on the same nights.
    const customers = await harness.rows<{ id: string }>(
      `INSERT INTO customers (first_name, last_name, email)
       VALUES ('Dispo', 'Test', 'dispo@test.example') RETURNING id`,
    );
    await harness.execute(
      `INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                                 rate_plan, total_amount_cents, free_cancellation_until,
                                 cancelled_at)
       VALUES ('DISPO001', $1, 'desk', '2034-05-01', '2034-05-03', 'confirmed', 'flexible', 0,
               '2034-04-29T13:00:00Z', NULL),
              ('DISPO002', $1, 'desk', '2034-05-01', '2034-05-03', 'cancelled', 'flexible', 0,
               '2034-04-29T13:00:00Z', now())`,
      [customers[0]?.id],
    );
    await harness.execute(
      `INSERT INTO reservation_rooms (reservation_id, category_id, adults, subtotal_cents)
       SELECT r.id, c.id, 2, 0
         FROM reservations r, room_categories c
        WHERE r.reference IN ('DISPO001', 'DISPO002') AND c.code = 'dispo-famille'`,
    );
    await harness.execute(
      `INSERT INTO sales_closures (category_id, period, reason)
       SELECT id, daterange('2034-05-02', '2034-05-03', '[)'), 'Travaux'
         FROM room_categories WHERE code = 'dispo-double'`,
    );
    await harness.execute(
      `INSERT INTO rate_periods (name, kind, category_id, period, adjustment_pct)
       SELECT 'Salon dispo', 'event', id, daterange('2034-05-02', '2034-05-03', '[)'), 30
         FROM room_categories WHERE code = 'dispo-famille'`,
    );
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
    it('requires a staff session', async () => {
      const response = await request(app).get(`${AVAILABILITY}?${STAY}&guests=2`);
      expect(response.status).toBe(401);
    });

    it('is closed to housekeeping', async () => {
      const response = await housekeeper.agent.get(`${AVAILABILITY}?${STAY}&guests=2`);
      expect(response.status).toBe(403);
    });
  });

  describe('rooms left', () => {
    it('counts, night by night, the usable rooms less the booked ones (RM-02)', async () => {
      const response = await search(`${STAY}&guests=2`);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.nights).toBe(3);

      const family = category(response, 'dispo-famille');
      // 3 active rooms (D504 is not); the released block of D502 does not count; the
      // cancelled stay does not count; D501 is out of service from 2 May.
      expect(family.freeRoomsByNight).toEqual([
        { night: '2034-04-30', free: 3 },
        { night: '2034-05-01', free: 2 },
        { night: '2034-05-02', free: 1 },
      ]);
      expect(family.freeRooms).toBe(1);
      expect(family.closed).toBe(false);
    });

    it('shows a category closed to sale on one night of the stay', async () => {
      const response = await search(`${STAY}&guests=2`);
      const double = category(response, 'dispo-double');
      expect(double.closed).toBe(true);
      expect(double.freeRooms).toBe(1);
    });
  });

  describe('prices', () => {
    it('prices each requested room at both rates, with the tourist tax apart', async () => {
      const response = await search(`${STAY}&guests=2-6_3`);
      const [couple, three] = category(response, 'dispo-famille').offers;

      // 2 adults and a child of 6: one child supplement; the event adds 30 % on 2 May.
      expect(couple?.nights?.map((night) => night.flexibleCents)).toEqual([11_500, 11_500, 14_500]);
      expect(couple?.flexibleCents).toBe(37_500);
      expect(couple?.nonRefundableCents).toBe(33_750);
      expect(couple?.touristTaxCents).toBe(2 * 3 * 250);

      // 3 adults: one adult supplement.
      expect(three?.flexibleCents).toBe(40_500);
      expect(three?.nonRefundableCents).toBe(36_450);
      expect(three?.touristTaxCents).toBe(3 * 3 * 250);
    });

    it('says when the guests do not fit in a category (RM-07)', async () => {
      const response = await search(`${STAY}&guests=2-6_2-1`);
      const [threeGuests, babyInCot] = category(response, 'dispo-double').offers;
      expect(threeGuests).toEqual({ fits: false });
      // A baby sleeps in a cot: 2 adults and a baby fit in a double.
      expect(babyInCot?.fits).toBe(true);
    });
  });

  describe('validation', () => {
    it('refuses an arrival in the past and a departure before the arrival (RM-04)', async () => {
      const past = await search('checkIn=2020-01-01&checkOut=2020-01-03&guests=2');
      expect(past.status).toBe(400);
      expect(past.body.errors).toEqual([
        { field: 'checkIn', message: 'L’arrivée ne peut pas être dans le passé.' },
      ]);

      const reversed = await search('checkIn=2034-05-03&checkOut=2034-05-01&guests=2');
      expect(reversed.body.errors.map((error: { field: string }) => error.field)).toEqual([
        'checkOut',
      ]);
    });

    it('refuses invalid guests and dates, naming the fields', async () => {
      const response = await search('checkIn=2034-02-30&checkOut=2034-03-02&guests=2--1');
      expect(response.status).toBe(400);
      const fields = (response.body.errors as { field: string }[]).map((error) => error.field);
      expect(fields).toEqual(['checkIn', 'guests']);
    });
  });
});
