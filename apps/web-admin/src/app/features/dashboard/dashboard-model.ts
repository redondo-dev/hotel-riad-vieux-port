/**
 * The dashboard of the management (GET /admin/dashboard) and the pure rules of the screen: the
 * figures written in French and their change since the month before.
 */

export interface DashboardMonth {
  /** « 2026-11 ». */
  month: string;
  roomNightsAvailable: number;
  roomNightsSold: number;
  nightsRevenueCents: number;
  feesCents: number;
  occupancyPct: number;
  revenueCents: number;
  averageRateCents: number;
}

export interface DoneCount {
  total: number;
  done: number;
}

export interface Dashboard {
  date: string;
  today: {
    roomsInService: number;
    roomsSold: number;
    occupancyPct: number;
    arrivals: DoneCount;
    departures: DoneCount;
  };
  month: DashboardMonth;
  previousMonth: DashboardMonth;
  incidents: { open: number; urgent: number };
}

/** Up (green), down (red) or unchanged. */
export type Trend = 'up' | 'down' | 'flat';

export function trendOf(now: number, before: number): Trend {
  if (now === before) {
    return 'flat';
  }
  return now > before ? 'up' : 'down';
}

const PERCENT = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const CHANGE = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});
const POINTS = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/** 11.8 → « 11,8 % ». */
export function percentText(value: number): string {
  return PERCENT.format(value / 100);
}

/** Change of a rate, in points: 0.3 → 3.3 gives « +3,0 pts ». */
export function pointsText(now: number, before: number): string {
  const difference = Math.round((now - before) * 10) / 10;
  if (difference === 0) {
    return 'stable';
  }
  return `${POINTS.format(difference)} pt${Math.abs(difference) >= 2 ? 's' : ''}`;
}

/** Change of an amount or a count, in %: 100 → 112 gives « +12 % »; from nothing: « nouveau ». */
export function changeText(now: number, before: number): string {
  if (before === 0) {
    return now === 0 ? 'stable' : 'nouveau';
  }
  const ratio = (now - before) / before;
  return Math.round(ratio * 100) === 0 ? 'stable' : CHANGE.format(ratio);
}

/** « 2026-11 » → « novembre 2026 ». */
export function monthText(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** « 4, dont 3 faites » for arrivals; « faits » for departures. */
export function doneText(count: DoneCount, feminine: boolean): string {
  const done = feminine ? 'faite' : 'fait';
  return `${count.total}, dont ${count.done} ${done}${count.done > 1 ? 's' : ''}`;
}
