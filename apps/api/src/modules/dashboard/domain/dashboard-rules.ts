import type { Role } from '../../identity/domain/identity-rules.ts';

/**
 * Pure rules of the dashboard of the management (UI/UX specification, D-9): the months compared
 * and the figures computed from the counts read in the database. Dates are « YYYY-MM-DD ».
 */

export const DASHBOARD_ROLES: readonly Role[] = ['direction'];

/** A month as [from, to): its first day and the first day of the next month. */
export interface MonthRange {
  month: string;
  from: string;
  to: string;
}

function monthOf(year: number, monthIndex: number): MonthRange {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    month: first.toISOString().slice(0, 7),
    from: first.toISOString().slice(0, 10),
    to: next.toISOString().slice(0, 10),
  };
}

/** The month of `date`, and the month before it (to compare). */
export function monthsAround(date: string): { current: MonthRange; previous: MonthRange } {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  return { current: monthOf(year, monthIndex), previous: monthOf(year, monthIndex - 1) };
}

/** What the database counts over a period of nights. */
export interface PeriodCounts {
  /** Active rooms not out of service, summed night by night. */
  roomNightsAvailable: number;
  /** Rooms sold (assigned or not), summed night by night; cancelled stays left out. */
  roomNightsSold: number;
  /** Price of the nights sold. */
  nightsRevenueCents: number;
  /** Cancellation and no-show fees of the stays planned to arrive in the period. */
  feesCents: number;
}

export interface PeriodFigures extends PeriodCounts {
  /** Rooms sold over rooms available, in %, one decimal. */
  occupancyPct: number;
  /** Nights and fees: the room revenue of the period. */
  revenueCents: number;
  /** Average price of a room-night sold (ADR); 0 when nothing is sold. */
  averageRateCents: number;
}

export function figuresOf(counts: PeriodCounts): PeriodFigures {
  const { roomNightsAvailable, roomNightsSold, nightsRevenueCents, feesCents } = counts;
  const occupancyPct =
    roomNightsAvailable === 0 ? 0 : Math.round((roomNightsSold * 1000) / roomNightsAvailable) / 10;
  return {
    ...counts,
    occupancyPct,
    revenueCents: nightsRevenueCents + feesCents,
    averageRateCents: roomNightsSold === 0 ? 0 : Math.round(nightsRevenueCents / roomNightsSold),
  };
}
