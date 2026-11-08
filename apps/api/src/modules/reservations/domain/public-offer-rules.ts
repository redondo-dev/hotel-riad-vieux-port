import type { FieldError } from '../../../shared/domain/errors.ts';
import { addDays, HOTEL_TIME_ZONE } from '../../catalog/domain/pricing.ts';

/**
 * Rules of the availability shown to visitors (step R-1), pure: no clock, no database.
 *
 *  - the online limits (RM-06): stay length, booking horizon, and the time after which an
 *    arrival on the same evening can no longer be booked online;
 *  - what a visitor may see: no identifier, no room number, no category closed to sale, only
 *    the categories able to take EVERY requested room, and the stock only when it is low.
 */

/** The current day and time at the hotel. */
export interface HotelClock {
  /** « YYYY-MM-DD ». */
  date: string;
  /** Minutes after midnight, from 0 to 1439. */
  minutesOfDay: number;
}

export function hotelClock(now: Date): HotelClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '0';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutesOfDay: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/** Set by the management in the hotel settings. */
export interface OnlineRules {
  maxStayNights: number;
  bookingHorizonDays: number;
  sameDayCutoffMinutes: number;
}

/** « 23 h », « 22 h 30 ». */
function timeText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Problems of the dates of a stay booked online (RM-04, RM-06). */
export function onlineStayErrors(
  checkIn: string,
  checkOut: string,
  clock: HotelClock,
  rules: OnlineRules,
): FieldError[] {
  const errors: FieldError[] = [];
  if (checkIn < clock.date) {
    errors.push({ field: 'checkIn', message: 'L’arrivée ne peut pas être dans le passé.' });
  } else if (checkIn === clock.date && clock.minutesOfDay >= rules.sameDayCutoffMinutes) {
    const time = timeText(rules.sameDayCutoffMinutes);
    const message = `Arrivée ce soir : réservation en ligne possible jusqu’à ${time}, appelez l’hôtel.`;
    errors.push({ field: 'checkIn', message });
  } else if (checkIn > addDays(clock.date, rules.bookingHorizonDays)) {
    const message = `Réservation en ligne jusqu’à ${rules.bookingHorizonDays} jours à l’avance.`;
    errors.push({ field: 'checkIn', message });
  }
  if (checkOut <= checkIn) {
    errors.push({ field: 'checkOut', message: 'Le départ doit suivre l’arrivée.' });
  } else if (checkOut > addDays(checkIn, rules.maxStayNights)) {
    const message = `${rules.maxStayNights} nuits au maximum en ligne.`;
    errors.push({ field: 'checkOut', message });
  }
  return errors;
}

/** At or under this many rooms left, the visitor is told (« Plus que 2 chambres »). */
export const LOW_STOCK_MAX = 3;

/** What the staff availability gives for one category, as far as the public needs it. */
export interface CandidateCategory {
  code: string;
  /** Rooms left on the tightest night of the stay. */
  freeRooms: number;
  /** Closed to sale on at least one night. */
  closed: boolean;
  /** One per requested room. */
  offers: (
    | { fits: true; flexibleCents: number; nonRefundableCents: number; touristTaxCents: number }
    | { fits: false }
  )[];
}

/** A category a visitor can book for the whole request; prices for all the rooms together. */
export interface PublicOffer {
  code: string;
  /** Rooms left, only when LOW_STOCK_MAX or fewer; null otherwise. */
  roomsLeft: number | null;
  flexibleCents: number;
  nonRefundableCents: number;
  /** Same for both rates, on a separate line (RM-13). */
  touristTaxCents: number;
}

export function publicOffers(categories: readonly CandidateCategory[]): PublicOffer[] {
  const offers: PublicOffer[] = [];
  for (const category of categories) {
    const priced = category.offers.flatMap((offer) => (offer.fits ? [offer] : []));
    const takesEveryRoom = priced.length === category.offers.length && priced.length > 0;
    if (category.closed || !takesEveryRoom || category.freeRooms < priced.length) {
      continue;
    }
    const sum = (amount: (offer: (typeof priced)[number]) => number): number =>
      priced.reduce((total, offer) => total + amount(offer), 0);
    offers.push({
      code: category.code,
      roomsLeft: category.freeRooms <= LOW_STOCK_MAX ? category.freeRooms : null,
      flexibleCents: sum((offer) => offer.flexibleCents),
      nonRefundableCents: sum((offer) => offer.nonRefundableCents),
      touristTaxCents: sum((offer) => offer.touristTaxCents),
    });
  }
  return offers;
}
