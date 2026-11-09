import { HOTEL_TIME_ZONE } from '../../catalog/domain/pricing.ts';

/**
 * Pure rules of a reservation: its reference, its free cancellation deadline, the quantity of
 * a service and the label kept with the price of each night. No clock, no database.
 */

export const RATE_PLANS = ['flexible', 'non_refundable'] as const;
export type RatePlan = (typeof RATE_PLANS)[number];

/** Where a reservation comes from; the staff takes only phone and desk bookings. */
export const ALL_SOURCES = ['website', 'phone', 'desk'] as const;
export const BOOKING_SOURCES = ['phone', 'desk'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
/** Any source, the website included (online bookings, step R-3). */
export type ReservationSource = (typeof ALL_SOURCES)[number];

export const RESERVATION_STATUSES = [
  'pending_payment',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show',
  'expired',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PricingUnit = 'per_person_night' | 'per_night' | 'per_stay' | 'per_unit';

/** Letters and digits easy to read on the phone: no 0/O nor 1/I. */
export const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERENCE_LENGTH = 8;

/** A new reference, « K7M2QX9A »; `randomIndex(n)` returns an integer from 0 to n - 1. */
export function newReference(randomIndex: (size: number) => number): string {
  let reference = '';
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    reference += REFERENCE_ALPHABET[randomIndex(REFERENCE_ALPHABET.length)];
  }
  return reference;
}

/** Offset of the time zone from UTC at `instant`, in minutes (+60 in winter in Marseille). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string): number => Number(parts.find((item) => item.type === type)?.value);
  const local = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((local - instant.getTime()) / 60_000);
}

/** The instant of a local date and time at the hotel (« 2026-05-12 », « 15:00:00 »). */
export function hotelInstant(date: string, time: string, timeZone = HOTEL_TIME_ZONE): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const wallClock = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute);
  // The offset is read at the guess, then again at the result: right across a change of time.
  const guess = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60_000;
  return new Date(wallClock - offsetMinutes(new Date(guess), timeZone) * 60_000);
}

/**
 * End of the free cancellation (RM-15): `hours` before the arrival time of the first day.
 * Only the flexible rate has one; the non-refundable rate never refunds (RM-16).
 */
export function freeCancellationUntil(options: {
  ratePlan: RatePlan;
  checkIn: string;
  checkInTime: string;
  freeCancellationHours: number;
}): Date | null {
  if (options.ratePlan !== 'flexible') {
    return null;
  }
  const arrival = hotelInstant(options.checkIn, options.checkInTime);
  return new Date(arrival.getTime() - options.freeCancellationHours * 3_600_000);
}

/**
 * Quantity charged for a service over the whole stay. Breakfast is counted per guest and per
 * night, babies excepted (RM-12); a service « per unit » takes the quantity typed.
 */
export function serviceQuantity(
  unit: PricingUnit,
  stay: { guests: number; nights: number; units: number },
): number {
  switch (unit) {
    case 'per_person_night':
      return stay.guests * stay.nights;
    case 'per_night':
      return stay.nights;
    case 'per_stay':
      return 1;
    case 'per_unit':
      return stay.units;
  }
}

/** Kept with the price of a night: the rate period applied, « +30 % », « −10 % », or nothing. */
export function nightLabel(adjustmentPct: number): string | null {
  if (adjustmentPct === 0) {
    return null;
  }
  const sign = adjustmentPct > 0 ? '+' : '−';
  return `${sign}${String(Math.abs(adjustmentPct)).replace('.', ',')} %`;
}
