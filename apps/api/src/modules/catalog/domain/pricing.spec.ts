import { describe, expect, it } from 'vitest';
import {
  type RatePeriod,
  addDays,
  adjustmentFor,
  applyPercent,
  fromPriceCents,
  hotelToday,
  nightlyPriceCents,
} from './pricing.ts';

const DOUBLE = 'categorie-double';
const SUITE = 'categorie-suite';

function period(
  kind: RatePeriod['kind'],
  categoryId: string | null,
  startDate: string,
  endDate: string,
  adjustmentPct: number,
): RatePeriod {
  return { kind, categoryId, startDate, endDate, adjustmentPct };
}

describe('addDays', () => {
  it('crosses months, years and leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('ignores the change to summer time', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });
});

describe('hotelToday', () => {
  it('counts the day in Marseille, not in UTC', () => {
    // 23:30 UTC on 31 December is already 1 January in Paris (UTC+1).
    expect(hotelToday(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(hotelToday(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14');
  });
});

describe('adjustmentFor', () => {
  const periods = [
    period('season', null, '2026-04-01', '2026-10-01', 20),
    period('season', SUITE, '2026-07-01', '2026-09-01', 30),
    period('event', null, '2026-07-10', '2026-07-12', 50),
    period('event', SUITE, '2026-07-11', '2026-07-12', 80),
  ];

  it('is 0 % without any period', () => {
    expect(adjustmentFor(periods, DOUBLE, '2026-02-10')).toBe(0);
  });

  it('applies a season of every category', () => {
    expect(adjustmentFor(periods, DOUBLE, '2026-05-10')).toBe(20);
  });

  it('prefers the season of the category to the season of every category', () => {
    expect(adjustmentFor(periods, SUITE, '2026-07-05')).toBe(30);
    expect(adjustmentFor(periods, DOUBLE, '2026-07-05')).toBe(20);
  });

  it('prefers an event to any season, and the event of the category to the others', () => {
    expect(adjustmentFor(periods, SUITE, '2026-07-10')).toBe(50);
    expect(adjustmentFor(periods, SUITE, '2026-07-11')).toBe(80);
  });

  it('treats the end date as the day after the last night', () => {
    expect(adjustmentFor(periods, DOUBLE, '2026-09-30')).toBe(20);
    expect(adjustmentFor(periods, DOUBLE, '2026-10-01')).toBe(0);
  });
});

describe('applyPercent', () => {
  it('rounds to the nearest cent', () => {
    expect(applyPercent(9500, 20)).toBe(11_400);
    expect(applyPercent(9999, 12.5)).toBe(11_249);
    expect(applyPercent(10_001, -10)).toBe(9001);
  });

  it('never gives a negative price', () => {
    expect(applyPercent(9500, -100)).toBe(0);
  });
});

describe('nightlyPriceCents and fromPriceCents', () => {
  const periods = [
    period('season', null, '2026-04-01', '2026-10-01', 20),
    period('season', DOUBLE, '2026-01-05', '2026-01-10', -15),
  ];

  it('prices a night with the period that applies', () => {
    expect(nightlyPriceCents(9500, DOUBLE, periods, '2026-05-01')).toBe(11_400);
    expect(nightlyPriceCents(9500, DOUBLE, periods, '2026-01-06')).toBe(8075);
  });

  it('takes the cheapest night of the window, at the non-refundable rate', () => {
    const base = { basePriceCents: 9500, periods, nonRefundableDiscountPct: 10 };
    // Window entirely in high season: the « from » price is the high season one.
    expect(
      fromPriceCents({ ...base, categoryId: SUITE, firstNight: '2026-05-01', nightCount: 30 }),
    ).toBe(10_260);
    // Window covering the January discount of the category.
    expect(
      fromPriceCents({ ...base, categoryId: DOUBLE, firstNight: '2026-01-01', nightCount: 30 }),
    ).toBe(7268);
    // Same window, other category: base price minus 10 %.
    expect(
      fromPriceCents({ ...base, categoryId: SUITE, firstNight: '2026-01-01', nightCount: 30 }),
    ).toBe(8550);
  });
});
