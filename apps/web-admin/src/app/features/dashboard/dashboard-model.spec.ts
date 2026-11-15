import { describe, expect, it } from 'vitest';
import {
  changeText,
  comparisonBarsOf,
  type DashboardMonth,
  donutOf,
  doneText,
  monthText,
  percentText,
  pointsText,
  progressOf,
  trendOf,
} from './dashboard-model';

/** Intl writes non-breaking spaces: compared here with plain spaces. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('changes since the month before', () => {
  it('gives a rate in points, an amount in %', () => {
    expect(plain(percentText(11.8))).toBe('11,8 %');
    expect(pointsText(3.3, 0.3)).toBe('+3,0 pts');
    expect(pointsText(5, 5.5)).toBe('-0,5 pt');
    expect(pointsText(4, 4)).toBe('stable');
    expect(plain(changeText(112, 100))).toBe('+12 %');
    expect(plain(changeText(90, 100))).toBe('-10 %');
  });

  it('never divides by zero', () => {
    expect(changeText(500, 0)).toBe('nouveau');
    expect(changeText(0, 0)).toBe('stable');
  });

  it('tells whether a figure goes up or down', () => {
    expect(trendOf(3.3, 0.3)).toBe('up');
    expect(trendOf(1, 2)).toBe('down');
    expect(trendOf(2, 2)).toBe('flat');
  });
});

describe('texts', () => {
  it('names the month and counts what is done', () => {
    expect(monthText('2026-11')).toBe('novembre 2026');
    expect(doneText({ total: 4, done: 3 }, true)).toBe('4, dont 3 faites');
    expect(doneText({ total: 1, done: 1 }, false)).toBe('1, dont 1 fait');
  });
});

describe('charts', () => {
  it('fills the ring with the rooms sold tonight', () => {
    expect(donutOf(2, 85)).toEqual({ fraction: 2 / 85, free: 83 });
    expect(donutOf(90, 85)).toEqual({ fraction: 1, free: 0 });
    expect(donutOf(0, 0)).toEqual({ fraction: 0, free: 0 });
  });

  it('gives the width of a progress bar, 0 when there is nothing', () => {
    expect(progressOf({ total: 4, done: 3 })).toBe(75);
    expect(progressOf({ total: 0, done: 0 })).toBe(0);
  });

  it('scales each pair of bars on the higher of the two months', () => {
    const month = (occupancyPct: number, revenueCents: number): DashboardMonth => ({
      month: '2026-11',
      roomNightsAvailable: 2550,
      roomNightsSold: 0,
      nightsRevenueCents: revenueCents,
      feesCents: 0,
      occupancyPct,
      revenueCents,
      averageRateCents: 0,
    });
    const bars = comparisonBarsOf(month(4.2, 1_406_260), month(0.3, 109_200));
    expect(bars[0]).toEqual({ label: 'Occupation', now: 100, before: 7 });
    expect(bars[1]).toEqual({ label: 'Chiffre d’affaires', now: 100, before: 8 });
    expect(bars[3]).toEqual({ label: 'Nuits vendues', now: 0, before: 0 });
  });
});
