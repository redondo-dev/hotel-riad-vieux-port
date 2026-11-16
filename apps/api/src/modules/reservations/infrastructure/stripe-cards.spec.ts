import { describe, expect, it } from 'vitest';
import { chargeResultOf, refundStatusOf, refusedChargeOf } from './stripe-cards.ts';

/** The answers of Stripe as plain objects: these tests never call Stripe. */

describe('charges of the saved card', () => {
  it('reads what the payment came to', () => {
    expect(chargeResultOf({ id: 'pi_1', status: 'succeeded' })).toEqual({
      status: 'succeeded',
      paymentIntentId: 'pi_1',
    });
    expect(chargeResultOf({ id: 'pi_2', status: 'processing' })).toEqual({
      status: 'pending',
      paymentIntentId: 'pi_2',
    });
    expect(chargeResultOf({ id: 'pi_3', status: 'requires_action' })).toEqual({
      status: 'failed',
      paymentIntentId: 'pi_3',
      failure: 'authentication_required',
    });
  });

  it('turns a card refused by the bank into a result, with its reason', () => {
    const declined = { type: 'StripeCardError', code: 'card_declined', payment_intent: null };
    expect(refusedChargeOf(declined)).toEqual({
      status: 'failed',
      paymentIntentId: null,
      failure: 'declined',
    });
    const funds = {
      type: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'insufficient_funds',
      payment_intent: { id: 'pi_4' },
    };
    expect(refusedChargeOf(funds)).toEqual({
      status: 'failed',
      paymentIntentId: 'pi_4',
      failure: 'insufficient_funds',
    });
    const secure = { type: 'StripeCardError', code: 'authentication_required' };
    expect(refusedChargeOf(secure)).toMatchObject({ failure: 'authentication_required' });
    const expired = { type: 'StripeCardError', code: 'expired_card' };
    expect(refusedChargeOf(expired)).toMatchObject({ failure: 'expired_card' });
  });

  it('leaves the other errors to be thrown again', () => {
    expect(refusedChargeOf({ type: 'StripeConnectionError' })).toBeUndefined();
    expect(refusedChargeOf(new Error('réseau'))).toBeUndefined();
    expect(refusedChargeOf(null)).toBeUndefined();
  });
});

describe('refunds', () => {
  it('reads the state of a refund', () => {
    expect(refundStatusOf('succeeded')).toBe('succeeded');
    expect(refundStatusOf('pending')).toBe('pending');
    expect(refundStatusOf('failed')).toBe('failed');
    expect(refundStatusOf(null)).toBe('failed');
  });
});
