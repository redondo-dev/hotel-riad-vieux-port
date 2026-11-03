import {
  addDays,
  adjustmentFor,
  applyPercent,
  type RatePeriod,
} from '../../catalog/domain/pricing.ts';

/**
 * Price of a stay in one room (business rules RM-08 to RM-11, RM-13), pure: no clock, no
 * database. The same function will price the desk bookings, then the online ones.
 *
 * Amounts are integer euro cents; a night is named by the day it starts.
 */

/** Guests of one room; each child is given by age, from 0 to 17. */
export interface Occupancy {
  adults: number;
  childrenAges: number[];
}

/** What the price of a room depends on, read from its category. */
export interface PricedCategory {
  id: string;
  maxOccupancy: number;
  /** Guests included in the base price (2, or 1 for the single room). */
  baseOccupancy: number;
  basePriceCents: number;
  /** Per extra guest and per night: adult or child aged 12 or more. */
  extraAdultCents: number;
  /** Per extra guest and per night: child aged 2 to 11. */
  extraChildCents: number;
}

export interface PricingSettings {
  nonRefundableDiscountPct: number;
  touristTaxCentsPerAdultNight: number;
}

/** A baby (0 or 1) sleeps in a cot: neither counted in the capacity nor charged (RM-10). */
export const INFANT_MAX_AGE = 1;
/** From this age a child pays the adult supplement (RM-10). */
export const ADULT_RATE_MIN_AGE = 12;

/** Guests counted against the capacity of the room (RM-07): babies are not. */
export function countedGuests(occupancy: Occupancy): number {
  const children = occupancy.childrenAges.filter((age) => age > INFANT_MAX_AGE).length;
  return occupancy.adults + children;
}

export function fitsIn(
  category: Pick<PricedCategory, 'maxOccupancy'>,
  occupancy: Occupancy,
): boolean {
  return countedGuests(occupancy) <= category.maxOccupancy;
}

/**
 * Supplement of one night for the guests beyond those included (RM-10). The places included
 * go to the guests who would pay the most: adults and children aged 12 or more first, then
 * the younger children. Example, base 2: 2 adults and a child of 6 pay one child supplement.
 */
export function supplementCents(category: PricedCategory, occupancy: Occupancy): number {
  const fees: number[] = [];
  for (let index = 0; index < occupancy.adults; index += 1) {
    fees.push(category.extraAdultCents);
  }
  for (const age of occupancy.childrenAges) {
    if (age >= ADULT_RATE_MIN_AGE) {
      fees.push(category.extraAdultCents);
    } else if (age > INFANT_MAX_AGE) {
      fees.push(category.extraChildCents);
    }
  }
  fees.sort((a, b) => b - a);
  return fees.slice(category.baseOccupancy).reduce((sum, fee) => sum + fee, 0);
}

export interface NightPrice {
  night: string;
  /** Rate period applied to the base price (0: none). */
  adjustmentPct: number;
  flexibleCents: number;
  nonRefundableCents: number;
}

export interface RoomQuote {
  nights: NightPrice[];
  flexibleCents: number;
  nonRefundableCents: number;
  /** Same for both rates; on a separate line (RM-13). Minors do not pay it. */
  touristTaxCents: number;
}

/** Nights of a stay: from the arrival day included to the departure day excluded (RM-01). */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  for (let night = checkIn; night < checkOut; night = addDays(night, 1)) {
    nights.push(night);
  }
  return nights;
}

/**
 * Price of the stay in one room. Each night: the base price changed by its rate period, plus
 * the supplement; the non-refundable price is that night less the discount (RM-11), rounded
 * night by night so that the total is exactly the sum of the nights kept with the booking.
 */
export function quoteRoom(options: {
  category: PricedCategory;
  periods: readonly RatePeriod[];
  checkIn: string;
  checkOut: string;
  occupancy: Occupancy;
  settings: PricingSettings;
}): RoomQuote {
  const { category, settings } = options;
  const supplement = supplementCents(category, options.occupancy);
  const nights = nightsOf(options.checkIn, options.checkOut).map((night): NightPrice => {
    const adjustmentPct = adjustmentFor(options.periods, category.id, night);
    const flexibleCents = applyPercent(category.basePriceCents, adjustmentPct) + supplement;
    return {
      night,
      adjustmentPct,
      flexibleCents,
      nonRefundableCents: applyPercent(flexibleCents, -settings.nonRefundableDiscountPct),
    };
  });
  return {
    nights,
    flexibleCents: nights.reduce((sum, night) => sum + night.flexibleCents, 0),
    nonRefundableCents: nights.reduce((sum, night) => sum + night.nonRefundableCents, 0),
    touristTaxCents:
      options.occupancy.adults * nights.length * settings.touristTaxCentsPerAdultNight,
  };
}
