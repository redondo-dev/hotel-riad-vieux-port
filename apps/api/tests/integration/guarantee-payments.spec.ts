import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CardGateway,
  CardRefund,
  ChargeResult,
  GuaranteeCharge,
  RefundResult,
} from '../../src/modules/reservations/application/card-gateway.ts';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Charges of the saved card and refunds by the management (step D-1) against the test
 * database, with a fake payment service: Stripe is never called (its answers are read in
 * stripe-cards.spec.ts). Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 15 (rooms Q15xx), the category « deb-double », August 2037 and the
 * e-mails « debit-… », with the clock fixed on 1 August 2037 at 10:00 in Marseille: an arrival
 * on 2 August cancelled now owes its first night (100 €).
 */

const RESERVATIONS = `${ADMIN}/reservations`;
const TODAY = '2037-08-01';
const NOW = new Date('2037-08-01T08:00:00Z');

type Session = Awaited<ReturnType<typeof logIn>>;

interface Payment {
  id: string;
  kind: 'payment' | 'refund';
  method: string;
  status: string;
  amountCents: number;
  refundedPaymentId: string | null;
  refundable: boolean;
}

interface Detail {
  id: string;
  status: string;
  paymentStatus: string;
  cancellationFeeCents: number;
  guaranteeChargeCents: number;
  payments: Payment[];
}

interface SavedSettings {
  discount: string;
  tax: number;
}

/** The fake payment service: what it was asked, and what it answers next. */
const charges: GuaranteeCharge[] = [];
const refunds: CardRefund[] = [];
let nextCharge: (charge: GuaranteeCharge) => ChargeResult = succeeded;
let nextRefund: (refund: CardRefund) => RefundResult = refundedAt;

function refundedAt(refund: CardRefund): RefundResult {
  return { refundId: `re_test_${refund.idempotencyKey}`, status: 'succeeded' };
}

function succeeded(charge: GuaranteeCharge): ChargeResult {
  return { status: 'succeeded', paymentIntentId: `pi_test_${charge.idempotencyKey}` };
}

const cards: CardGateway = {
  chargeSavedCard: async (charge) => {
    charges.push(charge);
    return nextCharge(charge);
  },
  refund: async (refund) => {
    refunds.push(refund);
    return nextRefund(refund);
  },
};

let keyCount = 0;

describe.skipIf(!hasTestDatabase)('charges of the saved card and refunds', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let reception: Session;
  let manager: Session;
  let saved: SavedSettings | undefined;
  let categoryId = '';

  function post(session: Session, path: string): request.Test {
    return session.agent.post(`${RESERVATIONS}${path}`).set('X-CSRF-Token', session.csrfToken);
  }

  async function detail(id: string): Promise<Detail> {
    const response = await manager.agent.get(`${RESERVATIONS}/${id}`);
    return response.body as Detail;
  }

  /** A flexible stay arriving tomorrow, booked at the desk; with a saved card if asked. */
  async function book(name: string, card: boolean): Promise<string> {
    keyCount += 1;
    const response = await post(reception, '')
      .set('Idempotency-Key', `test-debit-${String(keyCount).padStart(8, '0')}`)
      .send({
        ratePlan: 'flexible',
        source: 'desk',
        checkIn: '2037-08-02',
        checkOut: '2037-08-04',
        rooms: [{ categoryId, adults: 2 }],
        newCustomer: { firstName: name, lastName: 'Débit', email: `debit-${name}@test.example` },
      });
    if (response.status !== 201) {
      throw new Error(`réservation ${name} refusée (${response.status}) : ${response.text}`);
    }
    const id = String(response.body.id);
    if (card) {
      await harness.execute(
        `UPDATE reservations SET stripe_customer_id = $2, stripe_payment_method_id = $3
          WHERE id = $1`,
        [id, `cus_test_${name}`, `pm_test_${name}`],
      );
    }
    return id;
  }

  /** Booked then cancelled now: its first night is due (unless the management waives it). */
  async function cancelledStay(name: string, card = true, waiveFee = false): Promise<string> {
    const id = await book(name, card);
    const response = await post(manager, `/${id}/cancel`).send({ reason: 'Annulé', waiveFee });
    if (response.status !== 200) {
      throw new Error(`annulation ${name} refusée (${response.status}) : ${response.text}`);
    }
    return id;
  }

  async function paymentRows(id: string): Promise<{ status: string; kind: string }[]> {
    return harness.rows('SELECT status, kind FROM payments WHERE reservation_id = $1', [id]);
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app({ today: () => TODAY, now: () => NOW, cards });
    reception = await logIn(app, await harness.createStaff('reception'));
    manager = await logIn(app, await harness.createStaff('direction'));

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
    const categories = await harness.rows<{ id: string }>(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents)
       VALUES ('deb-double', 'Double débit', 'Double', 'D', 'D', 'L', 'B', 18,
               2, 2, 10000, 2500, 1500)
       RETURNING id`,
    );
    categoryId = categories[0]?.id ?? '';
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id, is_active)
       VALUES ('Q1501', 15, $1, true), ('Q1502', 15, $1, true), ('Q1503', 15, $1, true)`,
      [categoryId],
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

  describe('charge of the saved card', () => {
    it('charges the fees due on the saved card, once, and logs it', async () => {
      const id = await cancelledStay('amine');
      expect((await detail(id)).guaranteeChargeCents).toBe(10_000);

      const response = await post(manager, `/${id}/guarantee-charge`);
      expect(response.status).toBe(201);
      const body = response.body as Detail;
      expect(body.paymentStatus).toBe('paid');
      expect(body.guaranteeChargeCents).toBe(0);
      expect(body.payments).toHaveLength(1);
      expect(body.payments[0]).toMatchObject({
        kind: 'payment',
        method: 'card_online',
        status: 'succeeded',
        amountCents: 10_000,
        refundable: true,
      });
      // Never the identifiers of Stripe out of the API.
      expect(JSON.stringify(body)).not.toContain('pi_test_');
      expect(charges.at(-1)).toMatchObject({
        customerId: 'cus_test_amine',
        paymentMethodId: 'pm_test_amine',
        amountCents: 10_000,
        idempotencyKey: `guarantee-${id}-1`,
      });

      const again = await post(manager, `/${id}/guarantee-charge`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('CHARGE_NOT_ALLOWED');
      const audit = await harness.rows<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE '%guarantee%'`,
        [id],
      );
      expect(audit.map((row) => row.action)).toEqual(['reservation.guarantee_charged']);
    });

    it('is reserved to the management', async () => {
      const id = await cancelledStay('bilal');
      const response = await post(reception, `/${id}/guarantee-charge`);
      expect(response.status).toBe(403);
      expect(await paymentRows(id)).toEqual([]);
    });

    it('records a card refused, tells why, and lets the management try again', async () => {
      const id = await cancelledStay('chloe');
      nextCharge = () => ({ status: 'failed', paymentIntentId: null, failure: 'declined' });
      const refused = await post(manager, `/${id}/guarantee-charge`);
      nextCharge = succeeded;
      expect(refused.status).toBe(402);
      expect(refused.body.code).toBe('CARD_CHARGE_FAILED');
      expect(refused.body.detail).toContain('Carte refusée par la banque');
      expect(await paymentRows(id)).toEqual([{ status: 'failed', kind: 'payment' }]);
      expect((await detail(id)).guaranteeChargeCents).toBe(10_000);

      const retry = await post(manager, `/${id}/guarantee-charge`);
      expect(retry.status).toBe(201);
      expect(charges.at(-1)?.idempotencyKey).toBe(`guarantee-${id}-2`);
    });

    it('refuses a stay to come, a stay without card, and fees waived', async () => {
      const toCome = await book('david', true);
      const withoutCard = await cancelledStay('emma', false);
      const waived = await cancelledStay('farid', true, true);
      for (const id of [toCome, withoutCard, waived]) {
        const response = await post(manager, `/${id}/guarantee-charge`);
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('CHARGE_NOT_ALLOWED');
      }
      // Cancelled to free its room for the next tests.
      await post(manager, `/${toCome}/cancel`).send({ reason: 'Fin du test', waiveFee: true });
    });

    it('records nothing when the payment service does not answer', async () => {
      const id = await cancelledStay('gaelle');
      nextCharge = () => {
        throw new Error('délai dépassé');
      };
      const response = await post(manager, `/${id}/guarantee-charge`);
      nextCharge = succeeded;
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PAYMENT_UNAVAILABLE');
      expect(await paymentRows(id)).toEqual([]);
    });
  });

  describe('refunds', () => {
    it('refunds a payment made online in full, once', async () => {
      const id = await cancelledStay('hugo');
      const charged = (await post(manager, `/${id}/guarantee-charge`)).body as Detail;
      const payment = charged.payments[0];

      const response = await post(manager, `/${id}/payments/${payment?.id}/refund`);
      expect(response.status).toBe(201);
      const body = response.body as Detail;
      expect(body.paymentStatus).toBe('refunded');
      expect(body.payments.map((line) => [line.kind, line.status, line.amountCents])).toEqual([
        ['payment', 'succeeded', 10_000],
        ['refund', 'succeeded', 10_000],
      ]);
      expect(body.payments[1]?.refundedPaymentId).toBe(payment?.id);
      expect(body.payments[0]?.refundable).toBe(false);
      // Refunded: the fees are given up, the card is never charged again.
      expect(body.guaranteeChargeCents).toBe(0);
      const charge = await post(manager, `/${id}/guarantee-charge`);
      expect(charge.status).toBe(409);
      expect(charge.body.detail).toContain('remboursés');
      expect(refunds.at(-1)).toMatchObject({
        paymentIntentId: `pi_test_guarantee-${id}-1`,
        amountCents: 10_000,
        idempotencyKey: `refund-${payment?.id}-1`,
      });

      const again = await post(manager, `/${id}/payments/${payment?.id}/refund`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('NOT_REFUNDABLE');
    });

    it('refunds a payment received after the end of the booking', async () => {
      const id = await cancelledStay('ines', false, true);
      await harness.execute(
        `INSERT INTO payments (reservation_id, kind, method, amount_cents, status,
                               stripe_payment_intent_id, received_at)
         VALUES ($1, 'payment', 'card_online', 18000, 'succeeded', 'pi_test_late_ines', now())`,
        [id],
      );
      const late = (await detail(id)).payments[0];
      expect(late?.refundable).toBe(true);
      const response = await post(manager, `/${id}/payments/${late?.id}/refund`);
      expect(response.status).toBe(201);
      expect((response.body as Detail).paymentStatus).toBe('refunded');
    });

    it('never refunds a payment made at the hotel, nor for the reception', async () => {
      const id = await cancelledStay('jade', false, true);
      await harness.execute(
        `INSERT INTO payments (reservation_id, kind, method, amount_cents, status, received_at)
         VALUES ($1, 'payment', 'cash', 5000, 'succeeded', now())`,
        [id],
      );
      const cash = (await detail(id)).payments[0];
      expect(cash?.refundable).toBe(false);
      const byManager = await post(manager, `/${id}/payments/${cash?.id}/refund`);
      expect(byManager.status).toBe(409);
      const byReception = await post(reception, `/${id}/payments/${cash?.id}/refund`);
      expect(byReception.status).toBe(403);
    });

    it('tells a refund refused by the payment service, which may be asked again', async () => {
      const id = await cancelledStay('karim');
      const charged = (await post(manager, `/${id}/guarantee-charge`)).body as Detail;
      const paymentId = charged.payments[0]?.id;
      nextRefund = () => ({ refundId: 're_test_refused', status: 'failed' });
      const refused = await post(manager, `/${id}/payments/${paymentId}/refund`);
      nextRefund = refundedAt;
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('REFUND_FAILED');
      const retry = await post(manager, `/${id}/payments/${paymentId}/refund`);
      expect(retry.status).toBe(201);
      expect(refunds.at(-1)?.idempotencyKey).toBe(`refund-${paymentId}-2`);
    });
  });

  it('answers 503 when no payment service is configured', async () => {
    const bare = harness.app({ today: () => TODAY, now: () => NOW });
    const session = await logIn(bare, await harness.createStaff('direction'));
    const id = await cancelledStay('lina');
    const response = await session.agent
      .post(`${RESERVATIONS}/${id}/guarantee-charge`)
      .set('X-CSRF-Token', session.csrfToken);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PAYMENT_NOT_CONFIGURED');
  });
});
