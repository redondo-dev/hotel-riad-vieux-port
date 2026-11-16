/**
 * The payment service seen by the management (step D-1): the card saved as a guarantee charged
 * from afar, and the refunds of the payments made online. Stripe in real life
 * (infrastructure/stripe-cards.ts), a fake in the tests, which never call Stripe.
 *
 * Every call carries a key of idempotency: the same key never charges nor refunds twice, even
 * when the call is made again after a network failure.
 */

/** Why a charge was refused, as the staff can act on it. */
export type ChargeFailure =
  | 'declined'
  | 'insufficient_funds'
  | 'expired_card'
  | 'authentication_required'
  | 'other';

export interface GuaranteeCharge {
  reservationId: string;
  reference: string;
  /** Customer and card of the payment service, saved with the reservation (step R-5). */
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  /** Line shown in the account of the payment service: « Frais d'annulation ABCD2345 ». */
  description: string;
  idempotencyKey: string;
}

export type ChargeResult =
  | { status: 'succeeded' | 'pending'; paymentIntentId: string }
  | { status: 'failed'; paymentIntentId: string | null; failure: ChargeFailure };

export interface CardRefund {
  reservationId: string;
  paymentIntentId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface RefundResult {
  refundId: string;
  status: 'succeeded' | 'pending' | 'failed';
}

export interface CardGateway {
  /** Charges the saved card while the customer is away; a refusal is a result, not an error. */
  chargeSavedCard(charge: GuaranteeCharge): Promise<ChargeResult>;
  /** Gives back the whole payment; an error when the payment service does not answer. */
  refund(refund: CardRefund): Promise<RefundResult>;
}
