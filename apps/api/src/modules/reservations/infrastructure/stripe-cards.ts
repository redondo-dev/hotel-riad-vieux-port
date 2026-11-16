import type Stripe from 'stripe';
import type {
  CardGateway,
  ChargeFailure,
  ChargeResult,
  RefundResult,
} from '../application/card-gateway.ts';

/**
 * Stripe for the management (step D-1): the saved card charged « off session » (the customer is
 * away, as Stripe provides for a guarantee) and the refunds. A card refused, or a bank asking
 * the customer to confirm (3-D Secure), is a result told to the staff, never an error.
 */
export function stripeCards(stripe: Stripe): CardGateway {
  return {
    async chargeSavedCard(charge): Promise<ChargeResult> {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: charge.amountCents,
            currency: 'eur',
            customer: charge.customerId,
            payment_method: charge.paymentMethodId,
            off_session: true,
            confirm: true,
            description: charge.description,
            metadata: { reservationId: charge.reservationId, reference: charge.reference },
          },
          { idempotencyKey: charge.idempotencyKey },
        );
        return chargeResultOf(intent);
      } catch (error) {
        const refused = refusedChargeOf(error);
        if (refused === undefined) {
          throw error;
        }
        return refused;
      }
    },

    async refund(refund): Promise<RefundResult> {
      const result = await stripe.refunds.create(
        {
          payment_intent: refund.paymentIntentId,
          amount: refund.amountCents,
          metadata: { reservationId: refund.reservationId },
        },
        { idempotencyKey: refund.idempotencyKey },
      );
      return { refundId: result.id, status: refundStatusOf(result.status) };
    },
  };
}

/** What a payment of Stripe came to, once confirmed at once. */
export function chargeResultOf(intent: { id: string; status: string }): ChargeResult {
  switch (intent.status) {
    case 'succeeded':
      return { status: 'succeeded', paymentIntentId: intent.id };
    case 'processing':
      return { status: 'pending', paymentIntentId: intent.id };
    case 'requires_action':
      return { status: 'failed', paymentIntentId: intent.id, failure: 'authentication_required' };
    default:
      return { status: 'failed', paymentIntentId: intent.id, failure: 'declined' };
  }
}

/**
 * A card refused by the bank (Stripe throws an error of type « StripeCardError »); undefined for
 * any other error (network, key, request), which is thrown again.
 */
export function refusedChargeOf(error: unknown): ChargeResult | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const {
    type,
    code,
    decline_code: declineCode,
    payment_intent: intent,
  } = error as {
    type?: unknown;
    code?: unknown;
    decline_code?: unknown;
    payment_intent?: { id?: unknown } | null;
  };
  if (type !== 'StripeCardError') {
    return undefined;
  }
  const paymentIntentId = typeof intent?.id === 'string' ? intent.id : null;
  return { status: 'failed', paymentIntentId, failure: failureOf(code, declineCode) };
}

function failureOf(code: unknown, declineCode: unknown): ChargeFailure {
  if (code === 'authentication_required' || declineCode === 'authentication_required') {
    return 'authentication_required';
  }
  if (code === 'expired_card') {
    return 'expired_card';
  }
  if (declineCode === 'insufficient_funds') {
    return 'insufficient_funds';
  }
  return code === 'card_declined' ? 'declined' : 'other';
}

/** A refund of Stripe: « pending » while the bank has not given the money back yet. */
export function refundStatusOf(status: string | null): RefundResult['status'] {
  if (status === 'succeeded') {
    return 'succeeded';
  }
  return status === 'pending' || status === 'requires_action' ? 'pending' : 'failed';
}
