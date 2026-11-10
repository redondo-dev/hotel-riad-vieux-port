import type { ResolveFn } from '@angular/router';
import { checkoutReader } from '../../core/booking/checkout-reader';
import { type BookingSummary, bookingSummaryOf } from '../../core/booking/online-booking';

export type ConfirmationData =
  /** `sessionId`: to read the booking again while its payment is being checked (step R-5c). */
  | { kind: 'found'; summary: BookingSummary; sessionId: string }
  /** No identifier in the address, or no booking for it. */
  | { kind: 'missing' }
  | { kind: 'unavailable' };

const CHECKOUT_SESSION = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

/** The booking of the payment page Stripe sends back from (« ?session=cs_… »). */
export const confirmationResolver: ResolveFn<ConfirmationData> = async (route) => {
  const read = checkoutReader();
  const sessionId = route.queryParamMap.get('session') ?? '';
  if (!CHECKOUT_SESSION.test(sessionId)) {
    return { kind: 'missing' };
  }
  const answer = await read(sessionId);
  if (answer.status === 404 || answer.status === 400) {
    return { kind: 'missing' };
  }
  const summary = answer.status === 200 ? bookingSummaryOf(answer.body) : null;
  return summary === null ? { kind: 'unavailable' } : { kind: 'found', summary, sessionId };
};
