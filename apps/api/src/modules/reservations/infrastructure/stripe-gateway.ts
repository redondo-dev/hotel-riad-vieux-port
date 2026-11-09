import Stripe from 'stripe';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentGateway,
} from '../application/payment-gateway.ts';

/**
 * Stripe Checkout (decision « 2a » of 8 November 2026): the visitor pays, or saves a card,
 * on a page of Stripe, in French or in English, with 3-D Secure handled by Stripe.
 *
 *  - non-refundable rate: one payment of the amount;
 *  - flexible rate: the card is saved for later (no charge), on a Stripe customer, so that the
 *    hotel can charge a late cancellation or a no-show (later step).
 *
 * Each call carries an idempotency key built from the reservation: a retry never opens a
 * second page nor creates a second customer.
 */
export function stripeGateway(secretKey: string): PaymentGateway {
  const stripe = new Stripe(secretKey);

  return {
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      const metadata = { reservationId: request.reservationId, reference: request.reference };
      const common = {
        client_reference_id: request.reference,
        metadata,
        locale: request.locale,
        expires_at: Math.floor(request.expiresAt.getTime() / 1000),
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      };
      const key = `checkout-${request.reservationId}`;

      if (request.mode === 'payment') {
        const session = await stripe.checkout.sessions.create(
          {
            ...common,
            mode: 'payment',
            customer_email: request.customer.email,
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: 'eur',
                  unit_amount: request.amountCents,
                  product_data: { name: request.description },
                },
              },
            ],
            payment_intent_data: { metadata, description: request.description },
          },
          { idempotencyKey: key },
        );
        return { id: session.id, url: urlOf(session), customerId: null };
      }

      const customer = await stripe.customers.create(
        {
          email: request.customer.email,
          name: request.customer.name,
          phone: request.customer.phone,
          metadata,
        },
        { idempotencyKey: `customer-${request.reservationId}` },
      );
      const session = await stripe.checkout.sessions.create(
        {
          ...common,
          mode: 'setup',
          customer: customer.id,
          // Setup mode: the currency of the future charges (payment methods chosen by Stripe).
          currency: 'eur',
          setup_intent_data: { metadata, description: request.description },
        },
        { idempotencyKey: key },
      );
      return { id: session.id, url: urlOf(session), customerId: customer.id };
    },
  };
}

function urlOf(session: Stripe.Checkout.Session): string {
  if (session.url === null) {
    throw new Error('Stripe n’a pas donné l’adresse de la page de paiement');
  }
  return session.url;
}
