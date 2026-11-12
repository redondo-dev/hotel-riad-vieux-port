import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../src/app.ts';
import { ConfirmationEmails } from '../../src/modules/reservations/application/confirmation-emails.ts';
import { OnlinePayments } from '../../src/modules/reservations/application/online-payments.ts';
import type { CheckoutOutcome } from '../../src/modules/reservations/application/payment-events.ts';
import type { PaymentGateway } from '../../src/modules/reservations/application/payment-gateway.ts';
import { ReservationRepository } from '../../src/modules/reservations/infrastructure/reservation-repository.ts';
import { type MailMessage, MailRejectedError } from '../../src/shared/infrastructure/mailer.ts';
import { IdentityHarness, PUBLIC_SITE_URL } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * E-mails of confirmation of the bookings of the website (step R-6) against the test database,
 * with a fake sending service: Brevo is never called, and pg-boss is not started (the tests run
 * the task themselves). Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 13 (rooms M13xx), the categories « mail-… », June 2037 and the
 * customers « Courriel », with the current instant fixed on 1 May 2037 at 12:00 in Marseille.
 * It sets the hotel settings it needs and puts the previous ones back at the end. The task also
 * looks at the bookings other files confirmed: only the e-mails of this file are checked.
 */

const BOOKINGS = `${API_PREFIX}/public/bookings`;
const NOW = new Date('2037-05-01T10:00:00Z');

interface SavedSettings {
  discount: string;
  tax: number;
  maxStay: number;
  horizon: number;
  cutoff: string;
}

function sessionIdOf(reservationId: string): string {
  return `cs_test_${reservationId.replaceAll('-', '')}`;
}

const gateway: PaymentGateway = {
  createCheckout: async (checkout) => ({
    id: sessionIdOf(checkout.reservationId),
    url: `https://checkout.stripe.test/${checkout.reference}`,
    customerId: checkout.mode === 'setup' ? `cus_test_${checkout.reference}` : null,
  }),
  closeCheckout: async () => ({ kind: 'expired' }),
};

/**
 * The e-mails « sent ». `rejected`: every message refused for itself (address…); `down`: the
 * sending service fails (key refused, outage).
 */
const sent: MailMessage[] = [];
let failure: 'none' | 'rejected' | 'down' = 'none';
const mailer = {
  send: async (message: MailMessage) => {
    if (failure === 'rejected') {
      throw new MailRejectedError('Brevo a refusé l’e-mail (HTTP 400, invalid_parameter)');
    }
    if (failure === 'down') {
      throw new Error('Brevo a refusé l’e-mail (HTTP 401, unauthorized)');
    }
    sent.push(message);
  },
};

let keyCounter = 0;

function newKey(): string {
  keyCounter += 1;
  return `cle-de-test-courriel-${String(keyCounter).padStart(4, '0')}`;
}

function sentTo(email: string): MailMessage[] {
  return sent.filter((message) => message.to === email);
}

describe.skipIf(!hasTestDatabase)('e-mails of confirmation of the online bookings', () => {
  let harness: IdentityHarness;
  let saved: SavedSettings | undefined;
  const errors: string[] = [];

  function task(): ConfirmationEmails {
    return new ConfirmationEmails({
      sequelize: harness.sequelize,
      mailer,
      now: () => NOW,
      log: {
        warn: () => undefined,
        error: (_details, message) => {
          errors.push(message);
        },
      },
    });
  }

  /** Runs the task until it has nothing more to send (other files may have confirmed some). */
  async function runEmails(): Promise<void> {
    for (let run = 0; run < 10; run += 1) {
      const report = await task().run();
      if (report.sent + report.failed === 0) {
        return;
      }
      if (failure !== 'none') {
        return;
      }
    }
  }

  /** A booking of the website, confirmed as by the notification of Stripe. */
  async function confirmedBooking(
    stay: Record<string, unknown>,
    outcome: (reference: string) => CheckoutOutcome,
  ): Promise<string> {
    const app = harness.app({ now: () => NOW, payments: gateway });
    const response = await request(app)
      .post(BOOKINGS)
      .set('Idempotency-Key', newKey())
      .send({
        checkIn: '2037-06-08',
        checkOut: '2037-06-10',
        guests: '2',
        category: 'mail-double',
        ratePlan: 'non_refundable',
        language: 'fr',
        message: null,
        acceptTerms: true,
        successUrl: `${PUBLIC_SITE_URL}/reserver/confirmation`,
        cancelUrl: `${PUBLIC_SITE_URL}/reserver/choix`,
        ...stay,
      });
    expect(response.status).toBe(201);
    const reference = String(response.body.reference);
    const settlement = new OnlinePayments({
      sequelize: harness.sequelize,
      log: { warn: () => undefined, error: () => undefined },
    });
    const reservations = new ReservationRepository(harness.sequelize);
    await harness.sequelize.transaction(async (transaction) => {
      const booking = await reservations.onlineBooking({ reference }, transaction);
      if (booking === undefined) {
        throw new Error(`réservation ${reference} introuvable`);
      }
      await settlement.settle(booking, outcome(reference), transaction);
    });
    return reference;
  }

  function customer(firstName: string, email: string): Record<string, string> {
    const phone = '+33 6 55 44 33 22';
    return { firstName, lastName: 'Courriel', email, phone, countryCode: 'FR' };
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
       VALUES ('mail-double', 'Double courriel', 'Mail double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500, 1)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 13, c.id
         FROM room_categories c
         JOIN (VALUES ('M1301'), ('M1302'), ('M1303'), ('M1304')) AS v (number)
           ON c.code = 'mail-double'`,
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

  it('sends the e-mail once, in the language of the booking, with what was paid', async () => {
    const email = 'james.courriel@test.example';
    const reference = await confirmedBooking(
      { language: 'en', customer: customer('James', email) },
      (ref) => ({ kind: 'paid', paymentIntentId: `pi_test_${ref}`, amountCents: 2 * 7200 }),
    );

    await runEmails();
    await runEmails();

    const messages = sentTo(email);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.subject).toContain(`Your booking ${reference} is confirmed`);
    expect(messages[0]?.text).toContain('Hello James,');
    expect(messages[0]?.text).toContain('Paid online');
    expect(messages[0]?.html).toContain('<html lang="en">');
    const rows = await harness.rows<{ sentAt: Date | null }>(
      'SELECT confirmation_email_sent_at AS "sentAt" FROM reservations WHERE reference = $1',
      [reference],
    );
    expect(rows[0]?.sentAt).toEqual(NOW);
  });

  it('tells a flexible stay: card saved, nothing charged, free cancellation', async () => {
    const email = 'lina.courriel@test.example';
    await confirmedBooking(
      {
        ratePlan: 'flexible',
        checkIn: '2037-06-15',
        checkOut: '2037-06-16',
        customer: customer('Lina', email),
      },
      (ref) => ({ kind: 'card_saved', customerId: `cus_${ref}`, paymentMethodId: `pm_${ref}` }),
    );

    await runEmails();

    const text = sentTo(email)[0]?.text ?? '';
    expect(text).toContain('Bonjour Lina,');
    expect(text).toContain('rien n’a été débité');
    expect(text).toContain('Annulation gratuite jusqu’au');
    expect(text).not.toContain('Payé en ligne');
  });

  it('sends nothing for a booking still waiting for its payment', async () => {
    const email = 'noe.courriel@test.example';
    await confirmedBooking(
      { checkIn: '2037-06-18', checkOut: '2037-06-19', customer: customer('Noé', email) },
      () => ({ kind: 'processing' }),
    );

    await runEmails();

    expect(sentTo(email)).toEqual([]);
  });

  it('tries again next time when the e-mail is refused, counting the refusals', async () => {
    const email = 'ines.courriel@test.example';
    const reference = await confirmedBooking(
      { checkIn: '2037-06-22', checkOut: '2037-06-23', customer: customer('Inès', email) },
      (ref) => ({ kind: 'paid', paymentIntentId: `pi_test_${ref}`, amountCents: 7200 }),
    );

    failure = 'rejected';
    await runEmails();
    failure = 'none';

    expect(sentTo(email)).toEqual([]);
    expect(errors.some((message) => message.includes('nouvel essai'))).toBe(true);
    const failed = await harness.rows<{ attempts: number; sentAt: Date | null }>(
      `SELECT confirmation_email_attempts AS attempts, confirmation_email_sent_at AS "sentAt"
         FROM reservations WHERE reference = $1`,
      [reference],
    );
    expect(failed[0]).toEqual({ attempts: 1, sentAt: null });

    await runEmails();
    expect(sentTo(email)).toHaveLength(1);
  });

  it('counts nothing against the customers when the service itself fails', async () => {
    const email = 'zoe.courriel@test.example';
    const reference = await confirmedBooking(
      { checkIn: '2037-06-28', checkOut: '2037-06-29', customer: customer('Zoé', email) },
      (ref) => ({ kind: 'paid', paymentIntentId: `pi_test_${ref}`, amountCents: 7200 }),
    );

    failure = 'down';
    await runEmails();
    await runEmails();
    failure = 'none';

    expect(errors.some((message) => message.includes('envois suspendus'))).toBe(true);
    const rows = await harness.rows<{ attempts: number }>(
      'SELECT confirmation_email_attempts AS attempts FROM reservations WHERE reference = $1',
      [reference],
    );
    expect(rows[0]?.attempts).toBe(0);
    await runEmails();
    expect(sentTo(email)).toHaveLength(1);
  });

  it('gives up after 10 failures, telling the reception to call the customer', async () => {
    const email = 'paul.courriel@test.example';
    const reference = await confirmedBooking(
      { checkIn: '2037-06-25', checkOut: '2037-06-26', customer: customer('Paul', email) },
      (ref) => ({ kind: 'paid', paymentIntentId: `pi_test_${ref}`, amountCents: 7200 }),
    );
    await harness.execute(
      'UPDATE reservations SET confirmation_email_attempts = 9 WHERE reference = $1',
      [reference],
    );

    failure = 'rejected';
    await runEmails();
    failure = 'none';
    await runEmails();

    expect(sentTo(email)).toEqual([]);
    expect(errors.some((message) => message.includes('abandonné après 10 essais'))).toBe(true);
  });
});
