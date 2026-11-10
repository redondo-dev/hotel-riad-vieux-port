import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { InvalidSignatureError } from '../application/payment-events.ts';
import { stripeEvents } from './stripe-events.ts';

/**
 * Reading of the notifications of Stripe with the real Stripe library: the signatures are made
 * by its own test helper, with a secret of the tests. No network: Stripe is never called (the
 * card of a guarantee page is looked up by a stub).
 */

const SECRET = 'whsec_secret_reserve_aux_tests';
const stripe = new Stripe('sk_test_cle_factice_des_tests');

function signed(event: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify({ object: 'event', api_version: '2025-01-01', ...event });
  return {
    body: Buffer.from(payload, 'utf8'),
    signature: stripe.webhooks.generateTestHeaderString({ payload, secret }),
  };
}

function session(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'cs_test_a1',
    object: 'checkout.session',
    customer: null,
    setup_intent: null,
    payment_intent: null,
    amount_total: null,
    ...fields,
  };
}

const lookedUp: string[] = [];
const reader = stripeEvents(stripe, SECRET, async (setupIntentId) => {
  lookedUp.push(setupIntentId);
  return setupIntentId === 'seti_sans_carte' ? null : 'pm_test_carte';
});

describe('notifications of Stripe', () => {
  it('reads a paid page: its payment and the amount', async () => {
    const { body, signature } = signed({
      id: 'evt_paye',
      type: 'checkout.session.completed',
      data: {
        object: session({
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_test_1',
          amount_total: 14_400,
        }),
      },
    });

    expect(await reader.read(body, signature)).toEqual({
      id: 'evt_paye',
      type: 'checkout.session.completed',
      sessionId: 'cs_test_a1',
      outcome: { kind: 'paid', paymentIntentId: 'pi_test_1', amountCents: 14_400 },
    });
  });

  it('reads a guarantee page: the customer and the card saved, nothing charged', async () => {
    const { body, signature } = signed({
      id: 'evt_garantie',
      type: 'checkout.session.completed',
      data: {
        object: session({
          mode: 'setup',
          payment_status: 'no_payment_required',
          customer: 'cus_test_1',
          setup_intent: 'seti_test_1',
        }),
      },
    });

    const event = await reader.read(body, signature);

    expect(event.outcome).toEqual({
      kind: 'card_saved',
      customerId: 'cus_test_1',
      paymentMethodId: 'pm_test_carte',
    });
    expect(lookedUp).toContain('seti_test_1');
  });

  it('fails on a guarantee page without a card: Stripe sends it again later', async () => {
    const { body, signature } = signed({
      id: 'evt_sans_carte',
      type: 'checkout.session.completed',
      data: {
        object: session({ mode: 'setup', customer: 'cus_test_1', setup_intent: 'seti_sans_carte' }),
      },
    });

    await expect(reader.read(body, signature)).rejects.toThrow(/sans carte/);
  });

  it('waits while the money is on its way, then reads its arrival or its refusal', async () => {
    const waiting = signed({
      id: 'evt_en_route',
      type: 'checkout.session.completed',
      data: { object: session({ mode: 'payment', payment_status: 'unpaid' }) },
    });
    expect((await reader.read(waiting.body, waiting.signature)).outcome).toEqual({
      kind: 'processing',
    });

    const arrived = signed({
      id: 'evt_arrive',
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: session({
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_test_2',
          amount_total: 7200,
        }),
      },
    });
    expect((await reader.read(arrived.body, arrived.signature)).outcome).toMatchObject({
      kind: 'paid',
      paymentIntentId: 'pi_test_2',
    });

    const refused = signed({
      id: 'evt_refuse',
      type: 'checkout.session.async_payment_failed',
      data: { object: session({ mode: 'payment', payment_status: 'unpaid' }) },
    });
    expect((await reader.read(refused.body, refused.signature)).outcome).toEqual({
      kind: 'failed',
    });
  });

  it('reads a page closed without payment, and ignores the other notifications', async () => {
    const closed = signed({
      id: 'evt_ferme',
      type: 'checkout.session.expired',
      data: { object: session({ mode: 'payment', payment_status: 'unpaid' }) },
    });
    expect(await reader.read(closed.body, closed.signature)).toMatchObject({
      sessionId: 'cs_test_a1',
      outcome: { kind: 'expired' },
    });

    const other = signed({
      id: 'evt_autre',
      type: 'customer.created',
      data: { object: { id: 'cus_test_1', object: 'customer' } },
    });
    expect(await reader.read(other.body, other.signature)).toEqual({
      id: 'evt_autre',
      type: 'customer.created',
      sessionId: null,
      outcome: null,
    });
  });

  it('refuses a notification not signed by Stripe, or changed on the way', async () => {
    const event = {
      id: 'evt_faux',
      type: 'checkout.session.expired',
      data: { object: session({ mode: 'payment' }) },
    };
    const forged = signed(event, 'whsec_autre_secret');
    await expect(reader.read(forged.body, forged.signature)).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );

    const genuine = signed(event);
    const changed = Buffer.from(genuine.body.toString('utf8').replace('evt_faux', 'evt_autre'));
    await expect(reader.read(changed, genuine.signature)).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );

    await expect(reader.read(genuine.body, undefined)).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );
  });
});
