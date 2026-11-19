import type { PaymentStatus, RatePlan, ReservationStatus } from './reservation-rules.ts';

/**
 * Pure rules of a booking made on the website (step R-3): no clock, no database, no Stripe.
 */

/**
 * The payment page closes after 31 minutes (Stripe asks 30 at least, plus a margin for the
 * time of the call); the rooms are held 2 minutes longer, so that a payment made in time
 * always finds its rooms (decision « 2a »: 30 minutes rather than 15).
 */
export const CHECKOUT_MINUTES = 31;
export const HOLD_MINUTES = 33;

const MINUTE_MS = 60_000;

export function holdUntil(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * MINUTE_MS);
}

export function checkoutClosesAt(now: Date): Date {
  return new Date(now.getTime() + CHECKOUT_MINUTES * MINUTE_MS);
}

/**
 * What the visitors of one address may hold at the same time without paying (step S-2,
 * security review R-1 « M-1 »), beside the 5 bookings per 10 minutes: without it, a robot
 * booking again every 10 minutes would keep whole months full. A first booking always goes
 * through, however large (a group); one e-mail address holds one booking at a time.
 */
export interface PendingLimits {
  bookingsPerAddress: number;
  roomNightsPerAddress: number;
}

export const PENDING_LIMITS: PendingLimits = { bookingsPerAddress: 2, roomNightsPerAddress: 40 };

/** Bookings waiting for their payment: of the visitor's address, and of the e-mail address. */
export interface PendingLoad {
  addressBookings: number;
  addressRoomNights: number;
  emailBookings: number;
}

/** Rooms × nights of a stay. */
export function roomNightsOf(rooms: number, checkIn: string, checkOut: string): number {
  return rooms * Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
}

/** True when the new booking would hold more than one visitor may without paying. */
export function exceedsPendingLimits(
  load: PendingLoad,
  wantedRoomNights: number,
  limits: PendingLimits,
): boolean {
  if (load.emailBookings > 0 || load.addressBookings >= limits.bookingsPerAddress) {
    return true;
  }
  return (
    load.addressBookings > 0 &&
    load.addressRoomNights + wantedRoomNights > limits.roomNightsPerAddress
  );
}

/**
 * What is paid online: at the non-refundable rate, the stay at once, the tourist tax being
 * paid at the hotel as on the booking sites; at the flexible rate, nothing (card saved as a
 * guarantee, everything paid at the hotel).
 */
export function dueNowCents(
  ratePlan: RatePlan,
  totalCents: number,
  touristTaxCents: number,
): number {
  return ratePlan === 'non_refundable' ? totalCents - touristTaxCents : 0;
}

/**
 * State of the payment once the stay is paid online (decision « 2a » of step R-5): « partly
 * paid » while the tourist tax is still to be paid at the hotel, « paid » when there is none.
 */
export function paymentStatusAfterOnlinePayment(touristTaxCents: number): PaymentStatus {
  return touristTaxCents > 0 ? 'partially_paid' : 'paid';
}

/** « Double standard · 3 nuits », « Double standard · 3 nights ». */
export function stayDescription(category: string, nights: number, locale: 'fr' | 'en'): string {
  const plural = nights > 1;
  const unit = locale === 'fr' ? (plural ? 'nuits' : 'nuit') : plural ? 'nights' : 'night';
  return `${category} · ${nights} ${unit}`;
}

/**
 * The addresses back to the site must stay on the public site (never an address chosen by
 * someone else: the payment page would send the visitor there).
 */
export function isSiteAddress(address: string, siteUrl: string): boolean {
  try {
    const url = new URL(address);
    return url.origin === new URL(siteUrl).origin && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** What a visitor is told of the state of a booking made on the website. */
export type PublicBookingStatus = 'pending' | 'confirmed' | 'cancelled';

export function publicStatusOf(status: ReservationStatus): PublicBookingStatus {
  switch (status) {
    case 'pending_payment':
      return 'pending';
    case 'confirmed':
    case 'checked_in':
    case 'checked_out':
      return 'confirmed';
    default:
      return 'cancelled';
  }
}

/**
 * The page « ← Retour » of the payment page leads to, with the reference of the booking: the
 * site gives its rooms back at once (decision « 3a » of step R-4).
 */
export function withBookingReference(address: string, reference: string): string {
  const url = new URL(address);
  url.searchParams.set('booking', reference);
  return url.href;
}
