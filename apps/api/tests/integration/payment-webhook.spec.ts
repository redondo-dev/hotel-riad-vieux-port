import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../src/app.ts';
import {
  type CheckoutOutcome,
  InvalidSignatureError,
  type PaymentEvent,
  type PaymentEventReader,
} from '../../src/modules/reservations/application/payment-events.ts';
import type { PaymentGateway } from '../../src/modules/reservations/application/payment-gateway.ts';
import { IdentityHarness, PUBLIC_SITE_URL } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Notifications of the payment service (step R-5) against the test database, with a fake
 * payment service and a fake reader of the notifications, signed by a signature of the tests:
 * Stripe is never called (its signatures are checked in stripe-events.spec.ts). Skipped
 * without TEST_DATABASE_URL.
 *
 * This file owns floor 12 (rooms W12xx), the categories « wbh-… », February 2037 and the
 * customers « Webhook », with the current instant fixed on 15 January 2037 at 11:00 in
 * Marseille. It sets the hotel settings it needs and puts the previous ones back at the end.
 */

const BOOKINGS = `${API_PREFIX}/public/bookings`;
const WEBHOOK = `${API_PREFIX}/webhooks/stripe`;
const NOW = new Date('2037-01-15T10:00:00Z');
const SIGNATURE = 'signature-des-tests';

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
  paymentStatus: string;
  paymentExpiresAt: Date | null;
  sessionId: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
}

/** Shaped like an identifier of Stripe (letters and digits only), unique per reservation. */
function sessionIdOf(reservationId: string): string {
  return `cs_test_${reservationId.replaceAll('-', '')}`;
}

const gateway: PaymentGateway = {
  createCheckout: async (checkout) => ({
    id: sessionIdOf(checkout.reservationId),
    url: `https://checkout.stripe.test/${checkout.reference}`,
    customerId: checkout.mode === 'setup' ? `cus_test_${checkout.reference}` : null,
  }),
  expireCheckout: async () => 'expired',
};

/** Reads the bytes received exactly as Stripe's library does: untouched, or refused. */
const reader: PaymentEventReader = {
  read: async (rawBody, signature) => {
    if (!Buffer.isBuffer(rawBody)) {
      throw new Error('le corps de la notification a été lu avant la vérification');
    }
    if (signature !== SIGNATURE) {
      throw new InvalidSignatureError();
    }
    return JSON.parse(rawBody.toString('utf8')) as PaymentEvent;
  },
};

let keyCounter = 0;

function newKey(): string {
  keyCounter += 1;
  return `cle-de-test-webhook-${String(keyCounter).padStart(4, '0')}`;
}

function eventOf(sessionId: string | null, outcome: CheckoutOutcome | null): PaymentEvent {
  return {
    id: `evt_test_${randomUUID().replaceAll('-', '')}`,
    type: outcome === null ? 'customer.created' : 'checkout.session.completed',
    sessionId,
    outcome,
  };
}

describe.skipIf(!hasTestDatabase)('notifications of the payment service', () => {
  let harness: IdentityHarness;
  let saved: SavedSettings | undefined;

  function app(): ReturnType<IdentityHarness['app']> {
    return harness.app({ now: () => NOW, payments: gateway, paymentEvents: reader });
  }

  function notify(
    target: ReturnType<IdentityHarness['app']>,
    event: PaymentEvent,
    signature = SIGNATURE,
  ): request.Test {
    return request(target)
      .post(WEBHOOK)
      .set('Stripe-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
  }

  /** A booking of the website, waiting for its payment. */
  async function book(
    target: ReturnType<IdentityHarness['app']>,
    stay: Record<string, unknown>,
  ): Promise<{ reference: string; stored: StoredBooking }> {
    const response = await request(target)
      .post(BOOKINGS)
      .set('Idempotency-Key', newKey())
      .send({
        checkIn: '2037-02-10',
        checkOut: '2037-02-12',
        guests: '2',
        category: 'wbh-double',
        ratePlan: 'non_refundable',
        customer: {
          firstName: 'Nora',
          lastName: 'Webhook',
          email: 'nora.webhook@test.example',
          phone: '+33 6 98 76 54 32',
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
      `SELECT id, status, payment_status AS "paymentStatus",
              payment_expires_at AS "paymentExpiresAt",
              stripe_checkout_session_id AS "sessionId",
              stripe_customer_id AS "stripeCustomerId",
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

  async function paymentsOf(reservationId: string): Promise<Record<string, unknown>[]> {
    return harness.rows<Record<string, unknown>>(
      `SELECT kind, method, amount_cents AS "amountCents", status,
              stripe_payment_intent_id AS "paymentIntentId", recorded_by AS "recordedBy"
         FROM payments
        WHERE reservation_id = $1`,
      [reservationId],
    );
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
       VALUES ('wbh-double', 'Double notifiée', 'Notified double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 1),
              ('wbh-unique', 'Unique notifiée', 'Notified single', 'D', 'D', 'L', 'B', 14,
               2, 2, 6000, 2500, 1500, 2)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 12, c.id
         FROM room_categories c
         JOIN (VALUES ('W1201', 'wbh-double'), ('W1202', 'wbh-double'), ('W1203', 'wbh-double'),
                      ('W1211', 'wbh-unique')) AS v (number, code)
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

  describe('a payment received', () => {
    it('confirms the booking and records the payment, the tax left for the hotel', async () => {
      const target = app();
      const { reference, stored } = await book(target, {});
      // 2 nights at 72 € (−10 %); the tourist tax (2 adults × 2 nights × 2.50 €) apart.
      const paid: CheckoutOutcome = {
        kind: 'paid',
        paymentIntentId: `pi_test_${reference}`,
        amountCents: 2 * 7200,
      };

      const response = await notify(target, eventOf(stored.sessionId, paid));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true, handling: 'processed' });
      expect(await bookingOf(reference)).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'partially_paid',
        paymentExpiresAt: null,
      });
      expect(await paymentsOf(stored.id)).toEqual([
        {
          kind: 'payment',
          method: 'card_online',
          amountCents: 2 * 7200,
          status: 'succeeded',
          paymentIntentId: `pi_test_${reference}`,
          recordedBy: null,
        },
      ]);
      expect(await actionsOf(stored.id)).toEqual([
        'reservation.created',
        'reservation.terms_accepted',
        'reservation.payment_confirmed',
      ]);

      const page = await request(target).get(`${BOOKINGS}/checkout/${stored.sessionId}`);
      expect(page.body.status).toBe('confirmed');
    });

    it('handles a notification once, even sent twice, and a payment once', async () => {
      const target = app();
      const { reference, stored } = await book(target, {
        checkIn: '2037-02-14',
        checkOut: '2037-02-15',
      });
      const paid: CheckoutOutcome = {
        kind: 'paid',
        paymentIntentId: `pi_test_${reference}`,
        amountCents: 7200,
      };
      const event = eventOf(stored.sessionId, paid);

      expect((await notify(target, event)).body.handling).toBe('processed');
      expect((await notify(target, event)).body.handling).toBe('duplicate');
      // The same payment told again by another notification (delayed payment arrived).
      const again = { ...eventOf(stored.sessionId, paid), type: 'async_payment_succeeded' };
      expect((await notify(target, again)).body.handling).toBe('processed');

      expect(await paymentsOf(stored.id)).toHaveLength(1);
      expect((await actionsOf(stored.id)).filter((a) => a.endsWith('confirmed'))).toHaveLength(1);
    });

    it('keeps a payment arriving after the expiry, for the reception to refund', async () => {
      const target = app();
      const { reference, stored } = await book(target, {
        category: 'wbh-unique',
        checkIn: '2037-02-03',
        checkOut: '2037-02-04',
      });
      await notify(target, eventOf(stored.sessionId, { kind: 'expired' }));

      const late = await notify(
        target,
        eventOf(stored.sessionId, {
          kind: 'paid',
          paymentIntentId: `pi_test_${reference}`,
          amountCents: 5400,
        }),
      );

      expect(late.status).toBe(200);
      expect((await bookingOf(reference)).status).toBe('expired');
      expect(await paymentsOf(stored.id)).toHaveLength(1);
      expect(await actionsOf(stored.id)).toContain('reservation.late_payment');
    });
  });

  describe('a card saved as a guarantee', () => {
    it('confirms the booking with the Stripe references of the card, no charge', async () => {
      const target = app();
      const { reference, stored } = await book(target, {
        ratePlan: 'flexible',
        checkIn: '2037-02-16',
        checkOut: '2037-02-18',
      });

      const response = await notify(
        target,
        eventOf(stored.sessionId, {
          kind: 'card_saved',
          customerId: `cus_test_${reference}`,
          paymentMethodId: `pm_test_${reference}`,
        }),
      );

      expect(response.body.handling).toBe('processed');
      expect(await bookingOf(reference)).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'unpaid',
        paymentExpiresAt: null,
        stripeCustomerId: `cus_test_${reference}`,
        stripePaymentMethodId: `pm_test_${reference}`,
      });
      expect(await paymentsOf(stored.id)).toEqual([]);
      expect(await actionsOf(stored.id)).toContain('reservation.guarantee_saved');
    });
  });

  describe('a page closed without payment', () => {
    it('expires the booking and gives its rooms back at once', async () => {
      const target = app();
      const stay = { category: 'wbh-unique', checkIn: '2037-02-20', checkOut: '2037-02-22' };
      const { reference, stored } = await book(target, stay);

      await notify(target, eventOf(stored.sessionId, { kind: 'expired' }));

      expect((await bookingOf(reference)).status).toBe('expired');
      expect(await actionsOf(stored.id)).toContain('reservation.payment_expired');
      // The only room of the category can be booked again.
      await book(target, stay);
    });

    it('waits for a delayed payment, then expires the booking when it is refused', async () => {
      const target = app();
      const { reference, stored } = await book(target, {
        checkIn: '2037-02-24',
        checkOut: '2037-02-25',
      });

      await notify(target, eventOf(stored.sessionId, { kind: 'processing' }));
      expect((await bookingOf(reference)).status).toBe('pending_payment');

      await notify(target, eventOf(stored.sessionId, { kind: 'failed' }));
      expect((await bookingOf(reference)).status).toBe('expired');
    });
  });

  describe('what is refused or ignored', () => {
    it('refuses a notification without the right signature, and keeps nothing', async () => {
      const target = app();
      const event = eventOf(`cs_test_${'z'.repeat(20)}`, { kind: 'expired' });

      const forged = await notify(target, event, 'signature-inventee');
      expect(forged.status).toBe(400);
      expect(forged.body.code).toBe('INVALID_SIGNATURE');

      const unsigned = await request(target)
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event));
      expect(unsigned.status).toBe(400);

      const notJson = await request(target)
        .post(WEBHOOK)
        .set('Stripe-Signature', SIGNATURE)
        .set('Content-Type', 'text/plain')
        .send('bonjour');
      expect(notJson.status).toBe(400);

      const kept = await harness.rows<{ found: number }>(
        'SELECT 1 AS found FROM webhook_events WHERE event_id = $1',
        [event.id],
      );
      expect(kept).toEqual([]);
    });

    it('acknowledges the notifications the hotel does not use', async () => {
      const target = app();

      const other = await notify(target, eventOf(null, null));
      expect(other.status).toBe(200);
      expect(other.body.handling).toBe('ignored');

      const unknownPage = eventOf(`cs_test_${'y'.repeat(20)}`, { kind: 'expired' });
      expect((await notify(target, unknownPage)).body.handling).toBe('ignored');
    });

    it('does not exist while no webhook secret is set up', async () => {
      const target = harness.app({ now: () => NOW, payments: gateway });
      const response = await notify(target, eventOf(null, null));
      expect(response.status).toBe(404);
    });
  });
});
