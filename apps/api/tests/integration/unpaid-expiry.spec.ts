import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../src/app.ts';
import { OnlinePayments } from '../../src/modules/reservations/application/online-payments.ts';
import type { CheckoutOutcome } from '../../src/modules/reservations/application/payment-events.ts';
import type { PaymentGateway } from '../../src/modules/reservations/application/payment-gateway.ts';
import { UnpaidExpiry } from '../../src/modules/reservations/application/unpaid-expiry.ts';
import { IdentityHarness, PUBLIC_SITE_URL } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * End of the hold of the rooms of the bookings not paid in time (step R-5b), against the test
 * database, with a fake payment service: Stripe is never called, and pg-boss is not started
 * (the tests run the task themselves). Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 9 (rooms X9xx), the categories « exp-… », April 2037 and the customers
 * « Expiration », with the current instant fixed on 1 March 2037 at 11:00 in Marseille. It sets
 * the hotel settings it needs and puts the previous ones back at the end. The task also looks
 * at the bookings other files left waiting: they only expire, as they would.
 */

const BOOKINGS = `${API_PREFIX}/public/bookings`;
const NOW = new Date('2037-03-01T10:00:00Z');
const MINUTE_MS = 60_000;
/** One minute after the end of the hold (33 minutes). */
const AFTER_HOLD = new Date(NOW.getTime() + 34 * MINUTE_MS);

interface SavedSettings {
  discount: string;
  tax: number;
  maxStay: number;
  horizon: number;
  cutoff: string;
}

interface StoredBooking {
  id: string;
  status: string;
  sessionId: string;
  stripePaymentMethodId: string | null;
}

/** Shaped like an identifier of Stripe (letters and digits only), unique per reservation. */
function sessionIdOf(reservationId: string): string {
  return `cs_test_${reservationId.replaceAll('-', '')}`;
}

/** What each payment page came to, set by each test; « down »: Stripe does not answer. */
const outcomes = new Map<string, CheckoutOutcome | 'down'>();
/** Pages the task asked Stripe about. */
const asked: string[] = [];

const gateway: PaymentGateway = {
  createCheckout: async (checkout) => ({
    id: sessionIdOf(checkout.reservationId),
    url: `https://checkout.stripe.test/${checkout.reference}`,
    customerId: checkout.mode === 'setup' ? `cus_test_${checkout.reference}` : null,
  }),
  closeCheckout: async (sessionId) => {
    asked.push(sessionId);
    const outcome: CheckoutOutcome | 'down' = outcomes.get(sessionId) ?? { kind: 'expired' };
    if (outcome === 'down') {
      throw new Error('Stripe ne répond pas');
    }
    return outcome;
  },
};

let keyCounter = 0;

function newKey(): string {
  keyCounter += 1;
  return `cle-de-test-expiration-${String(keyCounter).padStart(4, '0')}`;
}

describe.skipIf(!hasTestDatabase)('end of the hold of the unpaid bookings', () => {
  let harness: IdentityHarness;
  let saved: SavedSettings | undefined;
  const errors: string[] = [];

  /** The task, as main.ts runs it every minute, at the instant `now`. */
  function expiry(now: Date): UnpaidExpiry {
    const log = {
      warn: () => undefined,
      error: (_details: Record<string, unknown>, message: string) => {
        errors.push(message);
      },
    };
    return new UnpaidExpiry({
      sequelize: harness.sequelize,
      payments: gateway,
      settlement: new OnlinePayments({ sequelize: harness.sequelize, log }),
      now: () => now,
      log,
    });
  }

  /** Runs the task until it has nothing more to do (other files may have left bookings). */
  async function runExpiry(now = AFTER_HOLD): Promise<void> {
    const task = expiry(now);
    for (let run = 0; run < 10; run += 1) {
      const report = await task.run();
      if (report.confirmed + report.expired === 0) {
        return;
      }
    }
  }

  /** A booking of the website made at `at`, waiting for its payment. */
  async function book(
    stay: Record<string, unknown>,
    at = NOW,
  ): Promise<{ reference: string; stored: StoredBooking }> {
    const app = harness.app({ now: () => at, payments: gateway });
    const response = await request(app)
      .post(BOOKINGS)
      .set('Idempotency-Key', newKey())
      .send({
        checkIn: '2037-04-06',
        checkOut: '2037-04-08',
        guests: '2',
        category: 'exp-double',
        ratePlan: 'non_refundable',
        customer: {
          firstName: 'Inès',
          lastName: 'Expiration',
          email: 'ines.expiration@test.example',
          phone: '+33 6 11 22 33 44',
          countryCode: 'FR',
        },
        language: 'fr',
        message: null,
        acceptTerms: true,
        successUrl: `${PUBLIC_SITE_URL}/reserver/confirmation`,
        cancelUrl: `${PUBLIC_SITE_URL}/reserver/choix`,
        ...stay,
      });
    expect(response.status).toBe(201);
    const reference = String(response.body.reference);
    return { reference, stored: await bookingOf(reference) };
  }

  async function bookingOf(reference: string): Promise<StoredBooking> {
    const rows = await harness.rows<StoredBooking>(
      `SELECT id, status, stripe_checkout_session_id AS "sessionId",
              stripe_payment_method_id AS "stripePaymentMethodId"
         FROM reservations
        WHERE reference = $1`,
      [reference],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`réservation ${reference} introuvable`);
    }
    return row;
  }

  async function paymentCount(reservationId: string): Promise<number> {
    const rows = await harness.rows<{ count: number }>(
      'SELECT count(*)::int AS count FROM payments WHERE reservation_id = $1',
      [reservationId],
    );
    return rows[0]?.count ?? 0;
  }

  async function actionsOf(reservationId: string): Promise<string[]> {
    const rows = await harness.rows<{ action: string }>(
      'SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id',
      [reservationId],
    );
    return rows.map((row) => row.action);
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    const settings = await harness.rows<SavedSettings>(
      `SELECT non_refundable_discount_pct::text AS discount,
              tourist_tax_cents_per_adult_night AS tax,
              online_max_stay_nights AS "maxStay", online_booking_horizon_days AS horizon,
              same_day_cutoff_time::text AS cutoff
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
              same_day_cutoff_time = '23:00'
        WHERE id = 1`,
    );
    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents,
         sort_order)
       VALUES ('exp-double', 'Double expirée', 'Expired double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 1),
              ('exp-unique', 'Unique expirée', 'Expired single', 'D', 'D', 'L', 'B', 14,
               2, 2, 6000, 2500, 1500, 2)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 9, c.id
         FROM room_categories c
         JOIN (VALUES ('X901', 'exp-double'), ('X902', 'exp-double'), ('X903', 'exp-double'),
                      ('X911', 'exp-unique')) AS v (number, code)
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
                same_day_cutoff_time = $5::time
          WHERE id = 1`,
        [saved.discount, saved.tax, saved.maxStay, saved.horizon, saved.cutoff],
      );
    }
    await harness.close();
  });

  it('expires a booking never paid, closes its page and gives its rooms back', async () => {
    const stay = { category: 'exp-unique', checkIn: '2037-04-10', checkOut: '2037-04-12' };
    const { reference, stored } = await book(stay);

    await runExpiry();

    expect(asked).toContain(stored.sessionId);
    expect((await bookingOf(reference)).status).toBe('expired');
    expect(await actionsOf(stored.id)).toContain('reservation.payment_expired');
    // The only room of the category can be booked again.
    await book(stay, AFTER_HOLD);
  });

  it('confirms a booking paid meanwhile, its notification never received', async () => {
    const { reference, stored } = await book({});
    outcomes.set(stored.sessionId, {
      kind: 'paid',
      paymentIntentId: `pi_test_${reference}`,
      amountCents: 2 * 7200,
    });

    await runExpiry();

    expect((await bookingOf(reference)).status).toBe('confirmed');
    expect(await paymentCount(stored.id)).toBe(1);
    expect(await actionsOf(stored.id)).toContain('reservation.payment_confirmed');
  });

  it('confirms a booking whose card was saved meanwhile, nothing charged', async () => {
    const { reference, stored } = await book({
      ratePlan: 'flexible',
      checkIn: '2037-04-14',
      checkOut: '2037-04-15',
    });
    outcomes.set(stored.sessionId, {
      kind: 'card_saved',
      customerId: `cus_test_${reference}`,
      paymentMethodId: `pm_test_${reference}`,
    });

    await runExpiry();

    expect(await bookingOf(reference)).toMatchObject({
      status: 'confirmed',
      stripePaymentMethodId: `pm_test_${reference}`,
    });
    expect(await paymentCount(stored.id)).toBe(0);
  });

  it('leaves a booking whose rooms are still held', async () => {
    const tenMinutesLater = new Date(NOW.getTime() + 10 * MINUTE_MS);
    const { reference, stored } = await book(
      { checkIn: '2037-04-16', checkOut: '2037-04-17' },
      tenMinutesLater,
    );

    await runExpiry();

    expect((await bookingOf(reference)).status).toBe('pending_payment');
    expect(asked).not.toContain(stored.sessionId);
  });

  it('keeps a booking while Stripe does not answer, and settles it the next time', async () => {
    const { reference, stored } = await book({ checkIn: '2037-04-20', checkOut: '2037-04-21' });
    outcomes.set(stored.sessionId, 'down');

    await runExpiry();

    expect((await bookingOf(reference)).status).toBe('pending_payment');
    expect(errors.some((message) => message.includes('état de la page de paiement'))).toBe(true);

    outcomes.set(stored.sessionId, { kind: 'expired' });
    await runExpiry();
    expect((await bookingOf(reference)).status).toBe('expired');
  });
});
