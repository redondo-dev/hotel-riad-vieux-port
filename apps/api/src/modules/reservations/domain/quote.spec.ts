import { describe, expect, it } from 'vitest';
import type { RatePeriod } from '../../catalog/domain/pricing.ts';
import {
  countedGuests,
  fitsIn,
  nightsOf,
  type Occupancy,
  type PricedCategory,
  quoteRoom,
  supplementCents,
} from './quote.ts';

const DOUBLE: PricedCategory = {
  id: 'double',
  maxOccupancy: 3,
  baseOccupancy: 2,
  basePriceCents: 10_000,
  extraAdultCents: 2500,
  extraChildCents: 1500,
};

const SETTINGS = { nonRefundableDiscountPct: 10, touristTaxCentsPerAdultNight: 250 };

function adults(count: number, ...childrenAges: number[]): Occupancy {
  return { adults: count, childrenAges };
}

describe('guests and capacity (RM-07, RM-10)', () => {
  it('does not count a baby in the capacity', () => {
    expect(countedGuests(adults(2, 1, 0))).toBe(2);
    expect(countedGuests(adults(2, 2))).toBe(3);
    expect(fitsIn(DOUBLE, adults(2, 6))).toBe(true);
    expect(fitsIn(DOUBLE, adults(2, 6, 4))).toBe(false);
  });

  it('charges the guests beyond those included, the dearest places included first', () => {
    expect(supplementCents(DOUBLE, adults(2))).toBe(0);
    expect(supplementCents(DOUBLE, adults(2, 6))).toBe(1500);
    expect(supplementCents(DOUBLE, adults(3))).toBe(2500);
    // The adult and the child of 14 take the two places; the child of 6 pays.
    expect(supplementCents(DOUBLE, adults(1, 6, 14))).toBe(1500);
    expect(supplementCents(DOUBLE, adults(2, 1))).toBe(0);
    expect(supplementCents({ ...DOUBLE, baseOccupancy: 1 }, adults(1))).toBe(0);
  });
});

describe('nightsOf (RM-01)', () => {
  it('counts from the arrival day to the day before the departure', () => {
    const nights = nightsOf('2034-01-30', '2034-02-02');
    expect(nights).toEqual(['2034-01-30', '2034-01-31', '2034-02-01']);
    expect(nightsOf('2034-01-30', '2034-01-30')).toEqual([]);
  });
});

describe('quoteRoom', () => {
  const summer: RatePeriod = {
    kind: 'season',
    categoryId: null,
    startDate: '2034-07-01',
    endDate: '2034-09-01',
    adjustmentPct: 20,
  };
  const concert: RatePeriod = {
    kind: 'event',
    categoryId: 'double',
    startDate: '2034-07-02',
    endDate: '2034-07-03',
    adjustmentPct: 30,
  };
  const periods = [summer, concert];

  it('prices each night with its period and the supplement', () => {
    const quote = quoteRoom({
      category: DOUBLE,
      periods,
      checkIn: '2034-06-30',
      checkOut: '2034-07-03',
      occupancy: adults(2, 6),
      settings: SETTINGS,
    });
    // Night, period applied, flexible price, non-refundable price.
    const rows = quote.nights.map((night) => [
      night.night,
      night.adjustmentPct,
      night.flexibleCents,
      night.nonRefundableCents,
    ]);
    expect(rows).toEqual([
      ['2034-06-30', 0, 11_500, 10_350],
      ['2034-07-01', 20, 13_500, 12_150],
      ['2034-07-02', 30, 14_500, 13_050],
    ]);
    expect(quote.flexibleCents).toBe(39_500);
    expect(quote.nonRefundableCents).toBe(35_550);
  });

  it('rounds the non-refundable price night by night', () => {
    const quote = quoteRoom({
      category: { ...DOUBLE, basePriceCents: 9999 },
      periods: [],
      checkIn: '2034-03-01',
      checkOut: '2034-03-03',
      occupancy: adults(2),
      settings: SETTINGS,
    });
    expect(quote.nights.map((night) => night.nonRefundableCents)).toEqual([8999, 8999]);
    expect(quote.nonRefundableCents).toBe(17_998);
  });

  it('charges the tourist tax per adult and per night, never for minors (RM-13)', () => {
    const quote = quoteRoom({
      category: DOUBLE,
      periods: [],
      checkIn: '2034-03-01',
      checkOut: '2034-03-04',
      occupancy: adults(2, 15),
      settings: SETTINGS,
    });
    expect(quote.touristTaxCents).toBe(2 * 3 * 250);
  });
});
