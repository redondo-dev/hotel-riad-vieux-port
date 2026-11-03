import type { RatePlan, ReservationStatus } from './reservation-rules.ts';

/**
 * Pure rules of the changes of a reservation: what may change in which state, the fee of a
 * cancellation, the nights a change of dates adds. No clock, no database.
 */

/** Dates and guests change only before the arrival (UI/UX specification, section 5.D). */
export const STAY_CHANGE_STATUSES: readonly ReservationStatus[] = ['confirmed'];

/** Cancelled before the arrival only; after it, the departure closes the stay. */
export const CANCELLABLE_STATUSES: readonly ReservationStatus[] = ['pending_payment', 'confirmed'];

/** A room is given or changed while the guest is expected or staying. */
export const ROOM_CHANGE_STATUSES: readonly ReservationStatus[] = ['confirmed', 'checked_in'];

/**
 * Fee of a cancellation (RM-15, RM-16), in cents:
 *  - flexible rate: nothing until the free cancellation deadline, then the first night of each
 *    room;
 *  - non-refundable rate: every night stays due (services and tourist tax are not, since the
 *    guest never came).
 */
export function cancellationFeeCents(options: {
  ratePlan: RatePlan;
  now: Date;
  freeCancellationUntil: Date | null;
  firstNightsCents: number;
  nightsCents: number;
}): number {
  if (options.ratePlan === 'non_refundable') {
    return options.nightsCents;
  }
  const deadline = options.freeCancellationUntil;
  return deadline !== null && options.now <= deadline ? 0 : options.firstNightsCents;
}

export interface NightRange {
  /** First night included. */
  from: string;
  /** Day after the last night (excluded). */
  to: string;
}

/**
 * Nights of the new stay that the old one did not have (at most two ranges: before and after),
 * for example to check that they are not closed to sale.
 */
export function addedNights(
  previous: { checkIn: string; checkOut: string },
  next: { checkIn: string; checkOut: string },
): NightRange[] {
  const ranges: NightRange[] = [];
  if (next.checkOut <= previous.checkIn || next.checkIn >= previous.checkOut) {
    return [{ from: next.checkIn, to: next.checkOut }];
  }
  if (next.checkIn < previous.checkIn) {
    ranges.push({ from: next.checkIn, to: previous.checkIn });
  }
  if (next.checkOut > previous.checkOut) {
    ranges.push({ from: previous.checkOut, to: next.checkOut });
  }
  return ranges;
}

/** True when `night` belongs to [checkIn, checkOut). */
export function isNightOf(night: string, stay: { checkIn: string; checkOut: string }): boolean {
  return stay.checkIn <= night && night < stay.checkOut;
}

/**
 * The version read in an If-Match header: « 3 » or « "3" » (HTTP writes it between quotes).
 * undefined when the header is missing or not a version.
 */
export function versionOf(ifMatch: string | undefined): number | undefined {
  const match = /^"?(\d{1,9})"?$/.exec(ifMatch?.trim() ?? '');
  return match === null ? undefined : Number(match[1]);
}
