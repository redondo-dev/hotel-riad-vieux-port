import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../src/app.ts';
import { IdentityHarness } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Availability for visitors (step R-1) against the test database: what is shown, what is
 * hidden, the online limits (RM-06) and the limit of searches. Skipped without
 * TEST_DATABASE_URL.
 *
 * This file owns floor 8 (rooms P8xx), the categories « pub-… » and the year 2036, with the
 * current instant fixed on 1 March 2036 at noon in Marseille. It sets the hotel settings it
 * needs and puts the previous ones back at the end.
 */

const AVAILABILITY = `${API_PREFIX}/public/availability`;
const NOON = new Date('2036-03-01T11:00:00Z');
const STAY = 'checkIn=2036-04-10&checkOut=2036-04-13';

interface Offer {
  code: string;
  roomsLeft: number | null;
  flexibleCents: number;
  nonRefundableCents: number;
  touristTaxCents: number;
}

interface SavedSettings {
  discount: string;
  tax: number;
  maxStay: number;
  horizon: number;
  cutoff: string;
  checkInTime: string;
  freeHours: number;
}

describe.skipIf(!hasTestDatabase)('availability for visitors', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let saved: SavedSettings | undefined;

  async function search(query: string, at = app): Promise<request.Response> {
    return request(at).get(`${AVAILABILITY}?${query}`);
  }

  /** The offers of this file only: other files leave their own categories. */
  function ours(response: request.Response): Offer[] {
    return (response.body.offers as Offer[]).filter((offer) => offer.code.startsWith('pub-'));
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app({ now: () => NOON });

    const settings = await harness.rows<SavedSettings>(
      `SELECT non_refundable_discount_pct::text AS discount,
              tourist_tax_cents_per_adult_night AS tax,
              online_max_stay_nights AS "maxStay", online_booking_horizon_days AS horizon,
              same_day_cutoff_time::text AS cutoff, check_in_time::text AS "checkInTime",
              free_cancellation_hours AS "freeHours"
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
    }
    await harness.execute(
      `UPDATE hotel_settings
          SET non_refundable_discount_pct = 10, tourist_tax_cents_per_adult_night = 250,
              online_max_stay_nights = 30, online_booking_horizon_days = 365,
              same_day_cutoff_time = '23:00', check_in_time = '15:00',
              free_cancellation_hours = 48
        WHERE id = 1`,
    );

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents,
         sort_order)
       VALUES ('pub-double', 'Double publique', 'Double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 1),
              ('pub-famille', 'Famille publique', 'Family', 'D', 'D', 'L', 'B', 25,
               4, 2, 10000, 2500, 1500, 2),
              ('pub-fermee', 'Fermée publique', 'Closed', 'D', 'D', 'L', 'B', 18,
               2, 2, 7000, 2500, 1500, 3)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 8, c.id
         FROM room_categories c
         JOIN (VALUES ('P801', 'pub-double'), ('P802', 'pub-double'), ('P803', 'pub-double'),
                      ('P804', 'pub-double'), ('P811', 'pub-famille'), ('P812', 'pub-famille'),
                      ('P821', 'pub-fermee')) AS v (number, code)
           ON v.code = c.code`,
    );
    // Closed to sale on one night of the stay: never offered online.
    await harness.execute(
      `INSERT INTO sales_closures (category_id, period, reason)
       SELECT id, daterange('2036-04-11', '2036-04-12', '[)'), 'Travaux'
         FROM room_categories WHERE code = 'pub-fermee'`,
    );
  });

  afterAll(async () => {
    if (saved === undefined) {
      await harness.execute('DELETE FROM hotel_settings WHERE id = 1');
    } else {
      await harness.execute(
        `UPDATE hotel_settings
            SET non_refundable_discount_pct = $1::numeric, tourist_tax_cents_per_adult_night = $2,
                online_max_stay_nights = $3, online_booking_horizon_days = $4,
                same_day_cutoff_time = $5::time, check_in_time = $6::time,
                free_cancellation_hours = $7
          WHERE id = 1`,
        [
          saved.discount,
          saved.tax,
          saved.maxStay,
          saved.horizon,
          saved.cutoff,
          saved.checkInTime,
          saved.freeHours,
        ],
      );
    }
    await harness.close();
  });

  describe('what a visitor sees', () => {
    it('answers without session, prices for both rates and nothing internal', async () => {
      const response = await search(`${STAY}&guests=2`);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.nights).toBe(3);
      // 48 hours before 15:00 on the day of arrival (summer time: UTC+2).
      expect(response.body.freeCancellationUntil).toBe('2036-04-08T13:00:00.000Z');

      const [double] = ours(response);
      expect(double).toEqual({
        code: 'pub-double',
        roomsLeft: null,
        flexibleCents: 3 * 8000,
        nonRefundableCents: 3 * 7200,
        touristTaxCents: 2 * 3 * 250,
      });
      // No identifier, no room number, no count of a comfortable stock.
      expect(JSON.stringify(response.body)).not.toMatch(/P80|"id"|freeRooms/);
    });

    it('tells the stock when 3 rooms or fewer are left', async () => {
      const response = await search(`${STAY}&guests=2`);
      const family = ours(response).find((offer) => offer.code === 'pub-famille');
      expect(family?.roomsLeft).toBe(2);
    });

    it('never offers a category closed to sale on a night of the stay', async () => {
      const response = await search(`${STAY}&guests=2`);
      expect(ours(response).map((offer) => offer.code)).toEqual(['pub-double', 'pub-famille']);
    });
  });

  describe('several rooms, one category', () => {
    it('offers a category only when it takes every requested room', async () => {
      const two = await search(`${STAY}&guests=2_2`);
      const family = ours(two).find((offer) => offer.code === 'pub-famille');
      expect(family?.flexibleCents).toBe(2 * 3 * 10_000);
      expect(family?.touristTaxCents).toBe(2 * 2 * 3 * 250);

      // Only 2 family rooms: 3 rooms are offered in the double only.
      const three = await search(`${STAY}&guests=2_2_2`);
      expect(ours(three).map((offer) => offer.code)).toEqual(['pub-double']);

      // 3 adults do not fit in a double (RM-07).
      const big = await search(`${STAY}&guests=3`);
      expect(ours(big).map((offer) => offer.code)).toEqual(['pub-famille']);
    });
  });

  describe('online limits (RM-06)', () => {
    it('closes an arrival on the same evening at 23:00, Marseille time', async () => {
      const tonight = 'checkIn=2036-03-01&checkOut=2036-03-02&guests=2';
      expect((await search(tonight)).status).toBe(200);

      const late = harness.app({ now: () => new Date('2036-03-01T22:00:00Z') });
      const response = await search(tonight, late);
      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        {
          field: 'checkIn',
          message: 'Arrivée ce soir : réservation en ligne possible jusqu’à 23 h, appelez l’hôtel.',
        },
      ]);
    });

    it('refuses more than 365 days ahead and more than 30 nights', async () => {
      const far = await search('checkIn=2037-03-02&checkOut=2037-03-03&guests=2');
      expect(far.status).toBe(400);
      expect(far.body.errors[0].field).toBe('checkIn');

      const long = await search('checkIn=2036-04-01&checkOut=2036-05-02&guests=2');
      expect(long.status).toBe(400);
      expect(long.body.errors[0].field).toBe('checkOut');
    });

    it('refuses invalid guests, naming the field', async () => {
      const response = await search(`${STAY}&guests=0`);
      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('guests');
    });
  });

  describe('limit of searches', () => {
    it('answers 429 beyond 30 searches per minute from one address', async () => {
      const fresh = harness.app({ now: () => NOON });
      // Invalid searches count as well, and spare the database.
      for (let index = 0; index < 30; index += 1) {
        expect((await search('guests=2', fresh)).status).toBe(400);
      }
      const response = await search('guests=2', fresh);
      expect(response.status).toBe(429);
      expect(response.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
