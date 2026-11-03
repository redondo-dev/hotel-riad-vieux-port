import type { FieldError } from '../../../shared/domain/errors.ts';
import { addDays } from '../../catalog/domain/pricing.ts';
import type { Role } from '../../identity/domain/identity-rules.ts';
import type { Occupancy } from './quote.ts';

/**
 * Rules of a stay entered by the staff (phone or desk). The online limits (30 nights, 365 days
 * ahead, 23:00 for the same evening: RM-06) do not apply to the reception; only technical
 * bounds remain, so that a typing mistake (2062 instead of 2026) is caught.
 */

/** Management and reception take bookings; housekeeping and technicians do not. */
export const BOOKING_ROLES: readonly Role[] = ['direction', 'reception'];

export const STAFF_MAX_STAY_NIGHTS = 90;
export const STAFF_BOOKING_HORIZON_DAYS = 730;

export const GUEST_LIMITS = {
  maxRooms: 5,
  minAdults: 1,
  maxAdults: 4,
  maxChildren: 3,
  maxChildAge: 17,
} as const;

/** Problems of the dates of a stay, given the current day at the hotel (RM-04). */
export function stayDateErrors(checkIn: string, checkOut: string, today: string): FieldError[] {
  const errors: FieldError[] = [];
  if (checkIn < today) {
    errors.push({ field: 'checkIn', message: 'L’arrivée ne peut pas être dans le passé.' });
  } else if (checkIn > addDays(today, STAFF_BOOKING_HORIZON_DAYS)) {
    const message = 'L’arrivée est à plus de deux ans : vérifiez l’année.';
    errors.push({ field: 'checkIn', message });
  }
  if (checkOut <= checkIn) {
    errors.push({ field: 'checkOut', message: 'Le départ doit suivre l’arrivée.' });
  } else if (checkOut > addDays(checkIn, STAFF_MAX_STAY_NIGHTS)) {
    const message = `${STAFF_MAX_STAY_NIGHTS} nuits au maximum par réservation.`;
    errors.push({ field: 'checkOut', message });
  }
  return errors;
}

/**
 * Reads the guests written as in the addresses of the public site: one block per room
 * separated by « _ », in each block the adults then the ages of the children, separated by
 * « - ». « 2-6-3_2 »: a room for 2 adults with children aged 6 and 3, a room for 2 adults.
 * Returns the problem in French when the text is not valid.
 */
export function parseGuests(text: string): Occupancy[] | string {
  if (!/^\d{1,2}(-\d{1,2})*(_\d{1,2}(-\d{1,2})*)*$/.test(text)) {
    return 'Format attendu : « 2 » ou « 2-6_1 » (adultes, âges des enfants, « _ » par chambre).';
  }
  const rooms = text.split('_').map((block) => {
    const [adults = 0, ...childrenAges] = block.split('-').map(Number);
    return { adults, childrenAges };
  });
  if (rooms.length > GUEST_LIMITS.maxRooms) {
    return `${GUEST_LIMITS.maxRooms} chambres au maximum.`;
  }
  for (const room of rooms) {
    if (room.adults < GUEST_LIMITS.minAdults || room.adults > GUEST_LIMITS.maxAdults) {
      return `De ${GUEST_LIMITS.minAdults} à ${GUEST_LIMITS.maxAdults} adultes par chambre.`;
    }
    if (room.childrenAges.length > GUEST_LIMITS.maxChildren) {
      return `${GUEST_LIMITS.maxChildren} enfants au maximum par chambre.`;
    }
    if (room.childrenAges.some((age) => age > GUEST_LIMITS.maxChildAge)) {
      return `Un enfant a de 0 à ${GUEST_LIMITS.maxChildAge} ans.`;
    }
  }
  return rooms;
}
