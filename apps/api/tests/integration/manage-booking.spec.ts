import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API_PREFIX } from '../../src/app.ts';
import { OnlinePayments } from '../../src/modules/reservations/application/online-payments.ts';
import type { CheckoutOutcome } from '../../src/modules/reservations/application/payment-events.ts';
import type { PaymentGateway } from '../../src/modules/reservations/application/payment-gateway.ts';
import { newManageToken } from '../../src/modules/reservations/domain/manage-booking-rules.ts';
import { ManageLinkRequests } from '../../src/modules/reservations/application/manage-link-requests.ts';
import { ManageBookingRepository } from '../../src/modules/reservations/infrastructure/manage-booking-repository.ts';
import { ReservationRepository } from '../../src/modules/reservations/infrastructure/reservation-repository.ts';
import type { MailMessage } from '../../src/shared/infrastructure/mailer.ts';
import { IdentityHarness, PUBLIC_SITE_URL } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * « Gérer ma réservation » (step M) against the test database: the secret link, the reading of
 * the booking and its cancellation by the customer. Stripe is never called. Skipped without
 * TEST_DATABASE_URL.
 *
 * This file owns floor 14 (rooms G14xx), the categories « grm-… », July 2037 and the customers
 * « Gestion », with the current instant fixed on 1 June 2037 at 12:00 in Marseille. It sets
 * the hotel settings it needs and puts the previous ones back at the end.
 */

const BOOKINGS = `${API_PREFIX}/public/bookings`;
const MANAGE = `${BOOKINGS}/manage`;
const NOW = new Date('2037-06-01T10:00:00Z');
/** After the free cancellation deadline of a stay from 10 July (48 hours before). */
const AFTER_DEADLINE = new Date('2037-07-09T10:00:00Z');

interface SavedSettings {
  discount: string;
  tax: number;
  maxStay: number;
  horizon: number;
  cutoff: string;
  freeHours: number;
  checkInTime: string;
  linkDays: number;
}

const gateway: PaymentGateway = {
  createCheckout: async (checkout) => ({
    id: `cs_test_${checkout.reservationId.replaceAll('-', '')}`,
    url: `https://checkout.stripe.test/${checkout.reference}`,
    customerId: checkout.mode === 'setup' ? `cus_test_${checkout.reference}` : null,
  }),
  closeCheckout: async () => ({ kind: 'expired' }),
};

let keyCounter = 0;

function newKey(): string {
  keyCounter += 1;
  return `cle-de-test-gestion-${String(keyCounter).padStart(4, '0')}`;
}

describe.skipIf(!hasTestDatabase)('manage my booking', () => {
  let harness: IdentityHarness;
  let saved: SavedSettings | undefined;

  function app(now = NOW): ReturnType<IdentityHarness['app']> {
    return harness.app({ now: () => now, payments: gateway });
  }

  /** A confirmed booking of the website and its secret link. */
  async function booking(
    stay: Record<string, unknown>,
  ): Promise<{ reference: string; token: string; id: string; email: string }> {
    const key = newKey();
    const email = `lea.gestion.${keyCounter}@test.example`;
    const response = await request(app())
      .post(BOOKINGS)
      .set('Idempotency-Key', key)
      .send({
        checkIn: '2037-07-10',
        checkOut: '2037-07-12',
        guests: '2',
        category: 'grm-double',
        ratePlan: 'flexible',
        customer: {
          firstName: 'Léa',
          lastName: 'Gestion',
          email,
          phone: '+33 6 12 12 12 12',
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
    const ratePlan = stay['ratePlan'] ?? 'flexible';
    const outcome: CheckoutOutcome =
      ratePlan === 'flexible'
        ? { kind: 'card_saved', customerId: `cus_${reference}`, paymentMethodId: `pm_${reference}` }
        : { kind: 'paid', paymentIntentId: `pi_test_${reference}`, amountCents: 2 * 7200 };
    const settlement = new OnlinePayments({
      sequelize: harness.sequelize,
      log: { warn: () => undefined, error: () => undefined },
    });
    const reservations = new ReservationRepository(harness.sequelize);
    const links = new ManageBookingRepository(harness.sequelize);
    const { token, hash } = newManageToken();
    const id = await harness.sequelize.transaction(async (transaction) => {
      const record = await reservations.onlineBooking({ reference }, transaction);
      if (record === undefined) {
        throw new Error(`réservation ${reference} introuvable`);
      }
      await settlement.settle(record, outcome, transaction);
      await links.issueToken(record.id, hash, transaction);
      return record.id;
    });
    return { reference, token, id, email };
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const rows = await harness.rows<{ status: string }>(
      'SELECT status FROM reservations WHERE id = $1',
      [id],
    );
    return rows[0]?.status;
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    const settings = await harness.rows<SavedSettings>(
      `SELECT non_refundable_discount_pct::text AS discount,
              tourist_tax_cents_per_adult_night AS tax,
              online_max_stay_nights AS "maxStay", online_booking_horizon_days AS horizon,
              same_day_cutoff_time::text AS cutoff, free_cancellation_hours AS "freeHours",
              check_in_time::text AS "checkInTime",
              manage_link_days_after_checkout AS "linkDays"
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
              same_day_cutoff_time = '23:00', free_cancellation_hours = 48,
              check_in_time = '15:00', manage_link_days_after_checkout = 30
        WHERE id = 1`,
    );
    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents,
         sort_order)
       VALUES ('grm-double', 'Double gérée', 'Managed double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 1),
              ('grm-unique', 'Unique gérée', 'Managed single', 'D', 'D', 'L', 'B', 14,
               2, 2, 6000, 2500, 1500, 2)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 14, c.id
         FROM room_categories c
         JOIN (VALUES ('G1401', 'grm-double'), ('G1402', 'grm-double'), ('G1403', 'grm-double'),
                      ('G1411', 'grm-unique')) AS v (number, code)
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
                same_day_cutoff_time = $5::time, free_cancellation_hours = $6,
                check_in_time = $7::time, manage_link_days_after_checkout = $8
          WHERE id = 1`,
        [
          saved.discount,
          saved.tax,
          saved.maxStay,
          saved.horizon,
          saved.cutoff,
          saved.freeHours,
          saved.checkInTime,
          saved.linkDays,
        ],
      );
    }
    await harness.close();
  });

  describe('the link', () => {
    it('shows the booking with its secret link, and nothing of the card', async () => {
      const { reference, token } = await booking({});

      const response = await request(app()).post(MANAGE).send({ reference, token });

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        reference,
        status: 'confirmed',
        firstName: 'Léa',
        checkIn: '2037-07-10',
        checkOut: '2037-07-12',
        category: 'grm-double',
        ratePlan: 'flexible',
        freeCancellationUntil: '2037-07-08T13:00:00.000Z',
        cancellation: 'free',
      });
      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/pm_|cus_|gestion\.\d+@|\+33/);
    });

    it('answers the same to a wrong token, a wrong reference, an expired link', async () => {
      const { reference, token, id } = await booking({
        checkIn: '2037-07-14',
        checkOut: '2037-07-15',
      });
      const other = await booking({ checkIn: '2037-07-16', checkOut: '2037-07-17' });

      const wrongToken = await request(app()).post(MANAGE).send({ reference, token: other.token });
      const wrongReference = await request(app())
        .post(MANAGE)
        .send({ reference: other.reference, token });
      await harness.execute('UPDATE reservations SET manage_token_expires_at = $2 WHERE id = $1', [
        id,
        new Date(NOW.getTime() - 1000),
      ]);
      const expired = await request(app()).post(MANAGE).send({ reference, token });

      for (const response of [wrongToken, wrongReference, expired]) {
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('MANAGE_LINK_INVALID');
      }
      const { traceId: _first, ...wrong } = wrongToken.body as Record<string, unknown>;
      const { traceId: _second, ...gone } = expired.body as Record<string, unknown>;
      expect(wrong).toEqual(gone);

      const malformed = await request(app()).post(MANAGE).send({ reference, token: 'court' });
      expect(malformed.status).toBe(400);
      // The e-mail of the known booking leaves after the answer.
      await vi.waitFor(() => {
        expect(sent.some((message) => message.to === email)).toBe(true);
      });
    });

    it('stops the previous link when a new one is given', async () => {
      const { reference, token, id } = await booking({
        checkIn: '2037-07-18',
        checkOut: '2037-07-19',
      });
      const links = new ManageBookingRepository(harness.sequelize);
      await harness.sequelize.transaction(async (transaction) => {
        await links.issueToken(id, newManageToken().hash, transaction);
      });

      const response = await request(app()).post(MANAGE).send({ reference, token });
      expect(response.status).toBe(404);
    });
  });

  describe('the cancellation by the customer', () => {
    it('cancels a flexible stay at no cost before the deadline, the room given back', async () => {
      const stay = { category: 'grm-unique', checkIn: '2037-07-20', checkOut: '2037-07-22' };
      const { reference, token, id } = await booking(stay);

      const response = await request(app()).post(`${MANAGE}/cancel`).send({ reference, token });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'cancelled', cancellation: 'closed' });
      expect(await statusOf(id)).toBe('cancelled');
      const rows = await harness.rows<{ reason: string; fee: number }>(
        `SELECT cancellation_reason AS reason, cancellation_fee_cents AS fee
           FROM reservations WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ reason: 'Annulée par le client depuis le site', fee: 0 });
      const audit = await harness.rows<{ action: string }>(
        'SELECT action FROM audit_logs WHERE entity_id = $1',
        [id],
      );
      expect(audit.map((row) => row.action)).toContain('reservation.cancelled_by_customer');

      // Asked again (double click): the booking already cancelled.
      const again = await request(app()).post(`${MANAGE}/cancel`).send({ reference, token });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('cancelled');

      // The only room of the category can be booked again.
      await booking(stay);
    });

    it('refuses online a flexible stay after the deadline, and a non-refundable one', async () => {
      const flexible = await booking({ checkIn: '2037-07-10', checkOut: '2037-07-11' });
      const late = app(AFTER_DEADLINE);
      const access = { reference: flexible.reference, token: flexible.token };
      const view = await request(late).post(MANAGE).send(access);
      expect(view.body.cancellation).toBe('with_fee');
      const refused = await request(late).post(`${MANAGE}/cancel`).send(access);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('CANCELLATION_NOT_ONLINE');

      const paid = await booking({
        ratePlan: 'non_refundable',
        checkIn: '2037-07-24',
        checkOut: '2037-07-26',
      });
      const nonRefundable = await request(app())
        .post(`${MANAGE}/cancel`)
        .send({ reference: paid.reference, token: paid.token });
      expect(nonRefundable.status).toBe(409);
      expect(await statusOf(paid.id)).toBe('confirmed');
      expect(await statusOf(flexible.id)).toBe('confirmed');
    });
  });

  describe('a new link on request (« lien perdu »)', () => {
    const sent: MailMessage[] = [];
    let refused = false;
    const mailer = {
      send: async (message: MailMessage) => {
        if (refused) {
          throw new Error('Brevo a refusé l’e-mail (HTTP 401, unauthorized)');
        }
        sent.push(message);
      },
    };

    function requests(now = NOW): ManageLinkRequests {
      return new ManageLinkRequests({
        sequelize: harness.sequelize,
        mailer,
        site: { url: PUBLIC_SITE_URL, localePrefix: true },
        now: () => now,
        log: { warn: () => undefined, error: () => undefined },
      });
    }

    function tokenIn(message: MailMessage | undefined): string | undefined {
      return /\/fr\/gerer-ma-reservation#[A-Z0-9]{8}\.([\w-]{43})/.exec(message?.text ?? '')?.[1];
    }

    it('e-mails a new link to the address of the booking, the previous one stops', async () => {
      const { reference, token, email } = await booking({
        checkIn: '2037-07-27',
        checkOut: '2037-07-28',
      });

      const answer = await requests().request({ reference, email: email.toUpperCase() });

      expect(answer).toBe('sent');
      const message = sent.at(-1);
      expect(message?.to).toBe(email);
      expect(message?.subject).toContain(`Votre lien pour gérer la réservation ${reference}`);
      const fresh = tokenIn(message);
      expect(fresh).toBeDefined();
      const withNew = await request(app()).post(MANAGE).send({ reference, token: fresh });
      expect(withNew.status).toBe(200);
      const withOld = await request(app()).post(MANAGE).send({ reference, token });
      expect(withOld.status).toBe(404);
    });

    it('sends nothing for a wrong e-mail, an unknown booking, twice in 10 minutes', async () => {
      const { reference, email } = await booking({
        checkIn: '2037-07-29',
        checkOut: '2037-07-30',
      });
      const before = sent.length;

      expect(await requests().request({ reference, email: 'autre@test.example' })).toBe('ignored');
      expect(await requests().request({ reference: 'ZZZZ2222', email })).toBe('ignored');
      expect(await requests().request({ reference, email })).toBe('sent');
      expect(await requests().request({ reference, email })).toBe('ignored');
      expect(sent.length).toBe(before + 1);

      const later = new Date(NOW.getTime() + 11 * 60_000);
      expect(await requests(later).request({ reference, email })).toBe('sent');
    });

    it('keeps the previous link when the e-mail cannot be sent', async () => {
      const { reference, token, email } = await booking({
        checkIn: '2037-07-31',
        checkOut: '2037-08-01',
      });

      refused = true;
      const answer = await requests().request({ reference, email });
      refused = false;

      expect(answer).toBe('ignored');
      expect((await request(app()).post(MANAGE).send({ reference, token })).status).toBe(200);
    });

    it('answers the visitor the same, whether the booking exists or not', async () => {
      const { reference, email } = await booking({
        checkIn: '2037-08-02',
        checkOut: '2037-08-03',
      });
      const target = harness.app({ now: () => NOW, manageLinks: requests() });

      const unknown = await request(target)
        .post(`${MANAGE}/link`)
        .send({ reference: 'ZZZZ2222', email: 'personne@test.example' });
      const known = await request(target).post(`${MANAGE}/link`).send({ reference, email });

      expect(unknown.status).toBe(202);
      expect(known.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
      expect(unknown.headers['cache-control']).toBe('no-store');
      const malformed = await request(target)
        .post(`${MANAGE}/link`)
        .send({ reference, email: 'pas-une-adresse' });
      expect(malformed.status).toBe(400);
    });
  });
});
