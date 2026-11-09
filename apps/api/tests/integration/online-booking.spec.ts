import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../src/app.ts';
import type {
  CheckoutRequest,
  PaymentGateway,
} from '../../src/modules/reservations/application/payment-gateway.ts';
import { IdentityHarness, PUBLIC_SITE_URL } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Bookings made on the website (step R-3) against the test database, with a fake payment
 * service: Stripe is never called. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 11 (rooms N11xx), the categories « onl-… » and January 2037, with the
 * current instant fixed on 1 December 2036 at 11:00 in Marseille. It sets the hotel settings it
 * needs and puts the previous ones back at the end.
 */

const BOOKINGS = `${API_PREFIX}/public/bookings`;
const NOW = new Date('2036-12-01T10:00:00Z');

interface SavedSettings {
  discount: string;
  tax: number;
  maxStay: number;
  horizon: number;
  cutoff: string;
  checkInTime: string;
  freeHours: number;
}

interface Fake {
  gateway: PaymentGateway;
  calls: CheckoutRequest[];
}

/** Opens a pretend page, or fails like Stripe out of order. */
function fakePayments(options: { fail?: boolean } = {}): Fake {
  const calls: CheckoutRequest[] = [];
  const gateway: PaymentGateway = {
    createCheckout: async (checkout) => {
      calls.push(checkout);
      if (options.fail === true) {
        throw new Error('Stripe ne répond pas');
      }
      return {
        id: `cs_test_${checkout.reservationId}`,
        url: `https://checkout.stripe.test/${checkout.reference}`,
        customerId: checkout.mode === 'setup' ? `cus_test_${checkout.reference}` : null,
      };
    },
  };
  return { gateway, calls };
}

let keyCounter = 0;

/** A new key for each booking, as the site makes one per submission. */
function newKey(): string {
  keyCounter += 1;
  return `cle-de-test-en-ligne-${String(keyCounter).padStart(4, '0')}`;
}

function bookingBody(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    checkIn: '2037-01-12',
    checkOut: '2037-01-15',
    guests: '2',
    category: 'onl-double',
    ratePlan: 'non_refundable',
    customer: {
      firstName: 'Lina',
      lastName: 'Martin',
      email: 'lina.martin@test.example',
      phone: '+33 6 12 34 56 78',
      countryCode: 'FR',
    },
    language: 'fr',
    message: 'Arrivée vers 20 h.',
    acceptTerms: true,
    successUrl: `${PUBLIC_SITE_URL}/reserver/confirmation`,
    cancelUrl: `${PUBLIC_SITE_URL}/reserver/choix`,
    ...changes,
  };
}

describe.skipIf(!hasTestDatabase)('online booking', () => {
  let harness: IdentityHarness;
  let saved: SavedSettings | undefined;

  function post(
    app: ReturnType<IdentityHarness['app']>,
    body: Record<string, unknown>,
    key = newKey(),
  ): request.Test {
    return request(app).post(BOOKINGS).set('Idempotency-Key', key).send(body);
  }

  async function reservationOf(reference: string): Promise<Record<string, unknown> | undefined> {
    const rows = await harness.rows<Record<string, unknown>>(
      `SELECT r.id, r.status, r.source, r.created_by AS "createdBy",
              r.payment_expires_at AS "paymentExpiresAt",
              r.stripe_checkout_session_id AS "sessionId",
              r.stripe_customer_id AS "stripeCustomerId", r.total_amount_cents AS "totalCents",
              c.phone, c.country_code AS "countryCode", c.preferred_language AS language
         FROM reservations r JOIN customers c ON c.id = r.customer_id
        WHERE r.reference = $1`,
      [reference],
    );
    return rows[0];
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
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
       VALUES ('onl-double', 'Double en ligne', 'Online double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 1),
              ('onl-unique', 'Unique en ligne', 'Online single', 'D', 'D', 'L', 'B', 14,
               2, 2, 6000, 2500, 1500, 2)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 11, c.id
         FROM room_categories c
         JOIN (VALUES ('N1101', 'onl-double'), ('N1102', 'onl-double'), ('N1103', 'onl-double'),
                      ('N1111', 'onl-unique')) AS v (number, code)
           ON v.code = c.code`,
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

  describe('a booking waiting for its payment', () => {
    it('holds the rooms and opens a payment of the stay, the tax being paid at the hotel', async () => {
      const fake = fakePayments();
      const app = harness.app({ now: () => NOW, payments: fake.gateway });

      const response = await post(app, bookingBody());

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const { reference, checkoutUrl, paymentExpiresAt } = response.body;
      expect(reference).toMatch(/^[A-Z0-9]{8}$/);
      expect(checkoutUrl).toBe(`https://checkout.stripe.test/${reference}`);
      expect(paymentExpiresAt).toBe('2036-12-01T10:33:00.000Z');

      const [call] = fake.calls;
      expect(call).toMatchObject({
        reference,
        mode: 'payment',
        // 3 nights at 72 € (−10 %); the tourist tax (2 adults × 3 nights × 2.50 €) apart.
        amountCents: 3 * 7200,
        description: 'Double en ligne · 3 nuits',
        locale: 'fr',
        customer: { email: 'lina.martin@test.example', name: 'Lina Martin' },
        successUrl: `${PUBLIC_SITE_URL}/reserver/confirmation`,
      });
      expect(call?.expiresAt.toISOString()).toBe('2036-12-01T10:31:00.000Z');

      const stored = await reservationOf(reference);
      expect(stored).toMatchObject({
        status: 'pending_payment',
        source: 'website',
        createdBy: null,
        sessionId: `cs_test_${String(stored?.['id'])}`,
        stripeCustomerId: null,
        totalCents: 3 * 7200 + 1500,
        phone: '+33 6 12 34 56 78',
        countryCode: 'FR',
        language: 'fr',
      });
      const accepted = await harness.rows<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
        [stored?.['id']],
      );
      expect(accepted.map((row) => row.action)).toEqual([
        'reservation.created',
        'reservation.terms_accepted',
      ]);
    });

    it('saves the card as a guarantee at the flexible rate, without any charge', async () => {
      const fake = fakePayments();
      const app = harness.app({ now: () => NOW, payments: fake.gateway });

      const response = await post(app, bookingBody({ ratePlan: 'flexible', language: 'en' }));

      expect(response.status).toBe(201);
      expect(fake.calls[0]).toMatchObject({
        mode: 'setup',
        amountCents: 0,
        description: 'Online double · 3 nights',
        locale: 'en',
      });
      const stored = await reservationOf(response.body.reference);
      expect(stored?.['stripeCustomerId']).toBe(`cus_test_${response.body.reference}`);
      expect(stored?.['language']).toBe('en');
    });

    it('books once when the same request is sent twice (double click)', async () => {
      const fake = fakePayments();
      const app = harness.app({ now: () => NOW, payments: fake.gateway });
      const key = newKey();
      const body = bookingBody({ checkIn: '2037-01-20', checkOut: '2037-01-21' });

      const first = await post(app, body, key);
      const second = await post(app, body, key);

      expect(second.status).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(fake.calls).toHaveLength(1);
    });
  });

  describe('the rooms held', () => {
    it('refuses a room held by a booking waiting for its payment', async () => {
      const fake = fakePayments();
      const app = harness.app({ now: () => NOW, payments: fake.gateway });
      const stay = { category: 'onl-unique', checkIn: '2037-01-05', checkOut: '2037-01-07' };

      expect((await post(app, bookingBody(stay))).status).toBe(201);
      const second = await post(app, bookingBody(stay));

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('NO_LONGER_AVAILABLE');
    });

    it('gives the rooms back at once when Stripe fails, and the key can be used again', async () => {
      const stay = { category: 'onl-unique', checkIn: '2037-01-26', checkOut: '2037-01-28' };
      const key = newKey();
      const broken = harness.app({
        now: () => NOW,
        payments: fakePayments({ fail: true }).gateway,
      });

      const failed = await post(broken, bookingBody(stay), key);

      expect(failed.status).toBe(503);
      expect(failed.body.code).toBe('PAYMENT_UNAVAILABLE');
      const expired = await harness.rows<{ status: string }>(
        `SELECT r.status FROM reservations r
           JOIN reservation_rooms rr ON rr.reservation_id = r.id
           JOIN room_categories c ON c.id = rr.category_id
          WHERE c.code = 'onl-unique' AND r.check_in = '2037-01-26'`,
      );
      expect(expired).toEqual([{ status: 'expired' }]);

      const working = harness.app({ now: () => NOW, payments: fakePayments().gateway });
      expect((await post(working, bookingBody(stay), key)).status).toBe(201);
    });
  });

  describe('what is refused', () => {
    it('refuses unticked conditions, an address off the site, an unknown category', async () => {
      const app = harness.app({ now: () => NOW, payments: fakePayments().gateway });

      const terms = await post(app, bookingBody({ acceptTerms: false }));
      expect(terms.status).toBe(400);
      expect(terms.body.errors[0].field).toBe('acceptTerms');

      const away = await post(app, bookingBody({ successUrl: 'https://evil.example/merci' }));
      expect(away.status).toBe(400);
      expect(away.body.errors).toEqual([
        { field: 'successUrl', message: 'Adresse de retour hors du site public.' },
      ]);

      const unknown = await post(app, bookingBody({ category: 'onl-inconnue' }));
      expect(unknown.status).toBe(400);
      expect(unknown.body.errors[0].field).toBe('category');
    });

    it('requires a phone number and a key for each booking', async () => {
      const app = harness.app({ now: () => NOW, payments: fakePayments().gateway });
      const customer = { firstName: 'Lina', lastName: 'Martin', email: 'l@test.example' };

      const noPhone = await post(app, bookingBody({ customer }));
      expect(noPhone.status).toBe(400);
      expect(noPhone.body.errors[0].field).toBe('customer.phone');

      const noKey = await request(app).post(BOOKINGS).send(bookingBody());
      expect(noKey.status).toBe(400);
      expect(noKey.body.errors[0].field).toBe('Idempotency-Key');
    });

    it('answers 503 while no payment service is set up', async () => {
      const app = harness.app({ now: () => NOW });
      const response = await post(app, bookingBody());
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PAYMENT_NOT_CONFIGURED');
    });

    it('accepts 5 bookings per 10 minutes from one address, not more', async () => {
      const app = harness.app({ now: () => NOW, payments: fakePayments().gateway });
      // Invalid bookings count as well, and hold nothing.
      for (let index = 0; index < 5; index += 1) {
        expect((await post(app, bookingBody({ acceptTerms: false }))).status).toBe(400);
      }
      const response = await post(app, bookingBody({ acceptTerms: false }));
      expect(response.status).toBe(429);
    });
  });
});
