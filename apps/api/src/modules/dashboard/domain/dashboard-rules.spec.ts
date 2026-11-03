import { describe, expect, it } from 'vitest';
import { figuresOf, monthsAround } from './dashboard-rules.ts';

describe('monthsAround', () => {
  it('gives the month of the day and the month before, across a year', () => {
    expect(monthsAround('2034-05-10')).toEqual({
      current: { month: '2034-05', from: '2034-05-01', to: '2034-06-01' },
      previous: { month: '2034-04', from: '2034-04-01', to: '2034-05-01' },
    });
    expect(monthsAround('2034-01-31').previous).toEqual({
      month: '2033-12',
      from: '2033-12-01',
      to: '2034-01-01',
    });
  });
});

describe('figuresOf', () => {
  it('computes the occupancy, the revenue and the average rate', () => {
    const figures = figuresOf({
      roomNightsAvailable: 300,
      roomNightsSold: 200,
      nightsRevenueCents: 2_100_000,
      feesCents: 9500,
    });
    expect(figures.occupancyPct).toBe(66.7);
    expect(figures.revenueCents).toBe(2_109_500);
    expect(figures.averageRateCents).toBe(10_500);
  });

  it('gives 0 rather than a division by zero', () => {
    const empty = {
      roomNightsAvailable: 0,
      roomNightsSold: 0,
      nightsRevenueCents: 0,
      feesCents: 0,
    };
    expect(figuresOf(empty)).toMatchObject({ occupancyPct: 0, averageRateCents: 0 });
  });
});
