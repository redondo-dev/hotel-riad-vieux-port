/**
 * The payment service seen by the bookings (step R-3): Stripe in real life
 * (infrastructure/stripe-gateway.ts), a fake in the tests, which never call Stripe.
 *
 * The card is typed on the page of the payment service (Checkout), never on the site nor in
 * the API: the hotel only keeps identifiers of the payment service, never any card data.
 */

export interface CheckoutRequest {
  reservationId: string;
  reference: string;
  /** « payment »: paid at once (non-refundable rate); « setup »: card saved as a guarantee. */
  mode: 'payment' | 'setup';
  /** Amount paid at once, in cents; 0 for a guarantee. */
  amountCents: number;
  /** Line shown on the payment page: « Double standard · 3 nuits ». */
  description: string;
  customer: { email: string; name: string; phone: string };
  locale: 'fr' | 'en';
  /** The page closes at this instant; before the end of the hold of the rooms. */
  expiresAt: Date;
  /** Back to the site; « {CHECKOUT_SESSION_ID} » is replaced by the payment service. */
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Identifier of the payment page, kept with the reservation. */
  id: string;
  /** Where the visitor's browser goes to pay. */
  url: string;
  /** Customer of the payment service holding the saved card (guarantee); null for a payment. */
  customerId: string | null;
}

export interface PaymentGateway {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Closes a payment page the visitor left (« ← Retour »): « expired » when it can no longer
   * be paid, « already_complete » when it was paid meanwhile (then nothing is closed).
   */
  expireCheckout(sessionId: string): Promise<'expired' | 'already_complete'>;
}
