import { describe, expect, it } from 'vitest';
import { choiceOf, perNightCents, priceOf, ratePlanOf } from './booking-model';

const OFFER = {
  code: 'double-standard',
  roomsLeft: 2,
  flexibleCents: 37_800,
  nonRefundableCents: 34_020,
  touristTaxCents: 1500,
};
const AVAILABILITY = { nights: 3, freeCancellationUntil: null, offers: [OFFER] };

describe('rates', () => {
  it('reads a rate from the address, and nothing else', () => {
    expect(ratePlanOf('flexible')).toBe('flexible');
    expect(ratePlanOf('non-refundable')).toBe('non-refundable');
    expect(ratePlanOf('free')).toBeNull();
    expect(ratePlanOf(null)).toBeNull();
  });

  it('prices the stay at each rate, and per night', () => {
    expect(priceOf(OFFER, 'flexible')).toBe(37_800);
    expect(priceOf(OFFER, 'non-refundable')).toBe(34_020);
    expect(perNightCents(37_800, 3)).toBe(12_600);
    expect(perNightCents(10_000, 3)).toBe(3333);
  });
});

describe('choiceOf', () => {
  it('finds the chosen offer and its price', () => {
    expect(choiceOf(AVAILABILITY, 'double-standard', 'non-refundable')).toEqual({
      offer: OFFER,
      rate: 'non-refundable',
      totalCents: 34_020,
    });
  });

  it('gives nothing when the offer is gone or the rate unknown', () => {
    expect(choiceOf(AVAILABILITY, 'suite', 'flexible')).toBeNull();
    expect(choiceOf(AVAILABILITY, 'double-standard', 'cheap')).toBeNull();
    expect(choiceOf(AVAILABILITY, null, null)).toBeNull();
  });
});
