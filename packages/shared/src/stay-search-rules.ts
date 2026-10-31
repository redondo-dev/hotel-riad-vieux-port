import { addDays, daysBetween, type IsoDate, type ZonedNow } from './dates.js';
import { countedGuests, OCCUPANCY_LIMITS } from './search.js';

/**
 * Validation of a stay search against the approved business rules.
 *
 * The function is pure (no clock, no network): the current time is passed in. It is shared
 * by the screens and, later, by the API, so the visitor and the server apply exactly the
 * same rules. It returns error codes, never texts: each application translates them.
 */

export interface StaySearchRules {
  maxStayNights: number;
  bookingHorizonDays: number;
  sameDayCutoffMinutes: number;
}

/** A room being edited: a child's age may still be missing. */
export interface RoomDraft {
  adults: number;
  childrenAges: (number | null)[];
}

/** A search being edited, possibly incomplete. */
export interface StaySearchDraft {
  checkIn: IsoDate | null;
  checkOut: IsoDate | null;
  rooms: RoomDraft[];
}

export type StaySearchError =
  | { field: 'checkIn'; code: 'required' | 'inPast' | 'sameDayClosed' | 'tooFarAhead' }
  | { field: 'checkOut'; code: 'required' | 'notAfterCheckIn' | 'stayTooLong' }
  | { field: 'rooms'; code: 'noRoom' | 'tooManyRooms' }
  | {
      field: 'room';
      roomIndex: number;
      code: 'adultsOutOfRange' | 'tooManyChildren' | 'tooManyGuests';
    }
  | { field: 'childAge'; roomIndex: number; childIndex: number; code: 'required' | 'outOfRange' };

export function validateStaySearch(
  draft: StaySearchDraft,
  rules: StaySearchRules,
  now: ZonedNow,
): StaySearchError[] {
  const errors: StaySearchError[] = [];
  const { checkIn, checkOut } = draft;

  if (checkIn === null) {
    errors.push({ field: 'checkIn', code: 'required' });
  } else if (checkIn < now.date) {
    errors.push({ field: 'checkIn', code: 'inPast' });
  } else if (checkIn === now.date && now.minutesOfDay >= rules.sameDayCutoffMinutes) {
    errors.push({ field: 'checkIn', code: 'sameDayClosed' });
  } else if (checkIn > addDays(now.date, rules.bookingHorizonDays)) {
    errors.push({ field: 'checkIn', code: 'tooFarAhead' });
  }

  if (checkOut === null) {
    errors.push({ field: 'checkOut', code: 'required' });
  } else if (checkIn !== null && checkOut <= checkIn) {
    errors.push({ field: 'checkOut', code: 'notAfterCheckIn' });
  } else if (checkIn !== null && daysBetween(checkIn, checkOut) > rules.maxStayNights) {
    errors.push({ field: 'checkOut', code: 'stayTooLong' });
  }

  if (draft.rooms.length === 0) {
    errors.push({ field: 'rooms', code: 'noRoom' });
  } else if (draft.rooms.length > OCCUPANCY_LIMITS.maxRooms) {
    errors.push({ field: 'rooms', code: 'tooManyRooms' });
  }

  draft.rooms.forEach((room, roomIndex) => {
    if (room.adults < OCCUPANCY_LIMITS.minAdults || room.adults > OCCUPANCY_LIMITS.maxAdults) {
      errors.push({ field: 'room', roomIndex, code: 'adultsOutOfRange' });
    }
    if (room.childrenAges.length > OCCUPANCY_LIMITS.maxChildren) {
      errors.push({ field: 'room', roomIndex, code: 'tooManyChildren' });
    }
    room.childrenAges.forEach((age, childIndex) => {
      if (age === null) {
        errors.push({ field: 'childAge', roomIndex, childIndex, code: 'required' });
      } else if (!Number.isInteger(age) || age < 0 || age > OCCUPANCY_LIMITS.maxChildAge) {
        errors.push({ field: 'childAge', roomIndex, childIndex, code: 'outOfRange' });
      }
    });
    if (countedGuests(room) > OCCUPANCY_LIMITS.maxGuestsPerRoom) {
      errors.push({ field: 'room', roomIndex, code: 'tooManyGuests' });
    }
  });

  return errors;
}
