/**
 * Price of a night (business rules RM-08 and RM-09), shared by the catalogue (« from » price)
 * and, later, by the booking quotes: one single place decides which rate period applies.
 *
 * Dates are calendar days « YYYY-MM-DD » in the hotel's time zone; a night is named by the day
 * it starts. Amounts are integer euro cents.
 */

/** The hotel is in Marseille: « today » and every night are counted in this time zone. */
export const HOTEL_TIME_ZONE = 'Europe/Paris';

export interface RatePeriod {
  kind: 'season' | 'event';
  /** null: the period applies to every category. */
  categoryId: string | null;
  /** First night of the period. */
  startDate: string;
  /** Day after the last night (exclusive bound, as in the database). */
  endDate: string;
  /** Percentage added to the base price; negative for a discount (minimum -100). */
  adjustmentPct: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string): void {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`date invalide : ${date}`);
  }
}

/** The calendar day `days` days after `date` (negative to go back). */
export function addDays(date: string, days: number): string {
  assertDate(date);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The current calendar day at the hotel. */
export function hotelToday(now: Date = new Date()): string {
  // The « en-CA » format is « YYYY-MM-DD ».
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Adjustment of one night for one category. Priority: an event beats a season; on the same
 * level, a period of this category beats a period of every category. No period: 0 %.
 */
export function adjustmentFor(
  periods: readonly RatePeriod[],
  categoryId: string,
  night: string,
): number {
  let best: { rank: number; pct: number } | undefined;
  for (const period of periods) {
    const applies =
      (period.categoryId === null || period.categoryId === categoryId) &&
      period.startDate <= night &&
      night < period.endDate;
    if (!applies) {
      continue;
    }
    const rank = (period.kind === 'event' ? 2 : 0) + (period.categoryId === null ? 0 : 1);
    if (best === undefined || rank > best.rank) {
      best = { rank, pct: period.adjustmentPct };
    }
  }
  return best?.pct ?? 0;
}

/**
 * `cents` changed by `pct` %, rounded to the nearest cent. The percentage has at most two
 * decimals (database column numeric(6,2)): it is counted in hundredths to stay in integers.
 */
export function applyPercent(cents: number, pct: number): number {
  const hundredths = Math.round(pct * 100);
  return Math.max(0, Math.round((cents * (10_000 + hundredths)) / 10_000));
}

/** Price of one night at the flexible rate, before any option. */
export function nightlyPriceCents(
  basePriceCents: number,
  categoryId: string,
  periods: readonly RatePeriod[],
  night: string,
): number {
  return applyPercent(basePriceCents, adjustmentFor(periods, categoryId, night));
}

/**
 * Lowest price of a night over `nightCount` nights from `firstNight`, at the non-refundable rate
 * (the cheapest one): the « from » price shown to guests. It is never lower than a price that
 * can really be booked in this window.
 */
export function fromPriceCents(options: {
  basePriceCents: number;
  categoryId: string;
  periods: readonly RatePeriod[];
  firstNight: string;
  nightCount: number;
  nonRefundableDiscountPct: number;
}): number {
  const nights = Math.max(1, options.nightCount);
  let lowest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < nights; index += 1) {
    const night = addDays(options.firstNight, index);
    lowest = Math.min(
      lowest,
      nightlyPriceCents(options.basePriceCents, options.categoryId, options.periods, night),
    );
  }
  return applyPercent(lowest, -options.nonRefundableDiscountPct);
}
