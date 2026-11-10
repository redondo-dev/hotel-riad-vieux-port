import Stripe from 'stripe';
import {
  type CheckoutOutcome,
  InvalidSignatureError,
  type PaymentEvent,
  type PaymentEventReader,
} from '../application/payment-events.ts';

/** Finds the card saved by a guarantee page (one call to Stripe); null when there is none. */
export type PaymentMethodLookup = (setupIntentId: string) => Promise<string | null>;

type Expandable = string | { id: string } | null | undefined;

function idOf(value: Expandable): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

/**
 * The notifications of Stripe (webhook, step R-5). The signature (header « Stripe-Signature »)
 * is checked by the Stripe library on the exact bytes received, with the secret « whsec_… »
 * of the endpoint, and refused when it is more than 5 minutes old (replay of an old message).
 *
 * Only the notifications of the payment pages are used:
 *  - checkout.session.completed               paid, card saved, or money on its way;
 *  - checkout.session.async_payment_succeeded the money arrived later;
 *  - checkout.session.async_payment_failed    it never arrived;
 *  - checkout.session.expired                 the page closed without payment.
 * Every other one is acknowledged and ignored.
 */
export function stripeEvents(
  stripe: Stripe,
  webhookSecret: string,
  paymentMethodOf: PaymentMethodLookup = async (setupIntentId) =>
    idOf((await stripe.setupIntents.retrieve(setupIntentId)).payment_method),
): PaymentEventReader {
  return {
    async read(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent> {
      if (signature === undefined || signature === '') {
        throw new InvalidSignatureError();
      }
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch {
        throw new InvalidSignatureError();
      }
      return eventOf(event, paymentMethodOf);
    },
  };
}

async function eventOf(
  event: Stripe.Event,
  paymentMethodOf: PaymentMethodLookup,
): Promise<PaymentEvent> {
  const base = { id: event.id, type: event.type };
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return {
        ...base,
        sessionId: event.data.object.id,
        outcome: await outcomeOf(event.data.object, paymentMethodOf),
      };
    case 'checkout.session.async_payment_failed':
      return { ...base, sessionId: event.data.object.id, outcome: { kind: 'failed' } };
    case 'checkout.session.expired':
      return { ...base, sessionId: event.data.object.id, outcome: { kind: 'expired' } };
    default:
      return { ...base, sessionId: null, outcome: null };
  }
}

/**
 * What a completed payment page brought. A page completed without its identifiers is an
 * error: the notification is answered 500 and Stripe sends it again later.
 */
export async function outcomeOf(
  session: Stripe.Checkout.Session,
  paymentMethodOf: PaymentMethodLookup,
): Promise<CheckoutOutcome> {
  if (session.mode === 'setup') {
    const setupIntentId = idOf(session.setup_intent);
    const customerId = idOf(session.customer);
    const paymentMethodId = setupIntentId === null ? null : await paymentMethodOf(setupIntentId);
    if (customerId === null || paymentMethodId === null) {
      throw new Error(`Stripe : page de garantie ${session.id} terminée sans carte enregistrée`);
    }
    return { kind: 'card_saved', customerId, paymentMethodId };
  }
  if (session.payment_status !== 'paid') {
    return { kind: 'processing' };
  }
  const paymentIntentId = idOf(session.payment_intent);
  if (paymentIntentId === null || session.amount_total === null) {
    throw new Error(`Stripe : page de paiement ${session.id} payée sans paiement associé`);
  }
  return { kind: 'paid', paymentIntentId, amountCents: session.amount_total };
}
