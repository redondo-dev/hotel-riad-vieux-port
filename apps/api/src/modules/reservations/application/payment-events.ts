import { AppError } from '../../../shared/domain/errors.ts';

/**
 * Notifications of the payment service (step R-5): Stripe in real life
 * (infrastructure/stripe-events.ts), a fake in the tests. They are read from the exact bytes
 * received and their signature checked before anything else: nobody else can confirm a
 * booking. Only identifiers of the payment service come out of them, never any card data.
 */

/** What a payment page came to. */
export type CheckoutOutcome =
  /** Non-refundable rate: the stay is paid. */
  | { kind: 'paid'; paymentIntentId: string; amountCents: number }
  /** Flexible rate: the card is saved as a guarantee, nothing is charged. */
  | { kind: 'card_saved'; customerId: string; paymentMethodId: string }
  /** The page is done but the money is still on its way (delayed payment methods). */
  | { kind: 'processing' }
  /** A delayed payment was refused. */
  | { kind: 'failed' }
  /** The page closed without being paid. */
  | { kind: 'expired' };

export interface PaymentEvent {
  /** Identifier of the notification (« evt_… »): each one is handled once. */
  id: string;
  /** Its type at the payment service, kept in the table of the notifications. */
  type: string;
  /** The payment page it is about; null for the notifications the hotel does not use. */
  sessionId: string | null;
  outcome: CheckoutOutcome | null;
}

export interface PaymentEventReader {
  /** Throws InvalidSignatureError when the notification was not signed by the payment service. */
  read(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent>;
}

export class InvalidSignatureError extends AppError {
  constructor() {
    super({
      status: 400,
      code: 'INVALID_SIGNATURE',
      title: 'Signature invalide',
      detail: 'Cette notification n’est pas signée par le service de paiement.',
    });
  }
}
