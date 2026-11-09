import type { Availability, Offer } from '../../core/booking/availability-result';

/**
 * Pure rules of the results page and of the choice (no clock, no text: the screens translate).
 */

/** As written in the addresses of the site: « …&rate=non-refundable ». */
export type RatePlan = 'flexible' | 'non-refundable';

export const RATE_PLANS: readonly RatePlan[] = ['flexible', 'non-refundable'];

export function ratePlanOf(value: string | null | undefined): RatePlan | null {
  return RATE_PLANS.find((plan) => plan === value) ?? null;
}

/** Price of the whole stay (every room) at this rate, tourist tax apart. */
export function priceOf(offer: Offer, rate: RatePlan): number {
  return rate === 'flexible' ? offer.flexibleCents : offer.nonRefundableCents;
}

/** « soit 126 € par nuit »: every room together, rounded to the cent. */
export function perNightCents(totalCents: number, nights: number): number {
  return nights > 0 ? Math.round(totalCents / nights) : totalCents;
}

export interface Choice {
  offer: Offer;
  rate: RatePlan;
  totalCents: number;
}

/** The offer chosen on the results page, if it is still available. */
export function choiceOf(
  availability: Availability,
  code: string | null | undefined,
  rate: string | null | undefined,
): Choice | null {
  const plan = ratePlanOf(rate);
  const offer = availability.offers.find((item) => item.code === code);
  if (plan === null || offer === undefined) {
    return null;
  }
  return { offer, rate: plan, totalCents: priceOf(offer, plan) };
}
