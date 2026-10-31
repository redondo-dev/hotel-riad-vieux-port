import { isIsoDate, type IsoDate } from './dates.js';

/** Guests staying in one room. */
export interface RoomOccupancy {
  adults: number;
  /** Age of each child, from 0 to 17. */
  childrenAges: number[];
}

/** A complete and valid stay search. */
export interface StaySearchCriteria {
  checkIn: IsoDate;
  checkOut: IsoDate;
  rooms: RoomOccupancy[];
}

export const OCCUPANCY_LIMITS = {
  maxRooms: 5,
  minAdults: 1,
  maxAdults: 4,
  maxChildren: 3,
  maxChildAge: 17,
  /** Largest category (family room): 4 guests. */
  maxGuestsPerRoom: 4,
  /** Babies aged 0 or 1 sleep in a cot and are not counted in the room capacity. */
  infantMaxAge: 1,
} as const;

/**
 * Guests counted against the room capacity. Babies under 2 are not counted; a child whose
 * age is still unknown is counted, to stay on the safe side.
 */
export function countedGuests(room: { adults: number; childrenAges: (number | null)[] }): number {
  const countedChildren = room.childrenAges.filter(
    (age) => age === null || age > OCCUPANCY_LIMITS.infantMaxAge,
  ).length;
  return room.adults + countedChildren;
}

const SMALL_INTEGER = /^\d{1,2}$/;

/**
 * Compact, readable encoding of the guests for URLs.
 * One block per room separated by `_`; in each block, the number of adults then the
 * children's ages, separated by `-`. Example: `2-6-3_2` = room 1: 2 adults and children
 * aged 6 and 3; room 2: 2 adults.
 */
export function serializeGuests(rooms: RoomOccupancy[]): string {
  return rooms.map((room) => [room.adults, ...room.childrenAges].join('-')).join('_');
}

/** Reads the `serializeGuests` format. Returns `null` for any invalid or out-of-range value. */
export function parseGuests(value: string): RoomOccupancy[] | null {
  const blocks = value.split('_');
  if (blocks.length > OCCUPANCY_LIMITS.maxRooms) {
    return null;
  }
  const rooms: RoomOccupancy[] = [];
  for (const block of blocks) {
    const tokens = block.split('-');
    if (!tokens.every((token) => SMALL_INTEGER.test(token))) {
      return null;
    }
    const [adults, ...childrenAges] = tokens.map(Number);
    if (
      adults === undefined ||
      adults < OCCUPANCY_LIMITS.minAdults ||
      adults > OCCUPANCY_LIMITS.maxAdults ||
      childrenAges.length > OCCUPANCY_LIMITS.maxChildren ||
      childrenAges.some((age) => age > OCCUPANCY_LIMITS.maxChildAge)
    ) {
      return null;
    }
    rooms.push({ adults, childrenAges });
  }
  return rooms;
}

/** Query parameter names, identical in both languages. */
export const SEARCH_QUERY_PARAMS = {
  checkIn: 'arrival',
  checkOut: 'departure',
  guests: 'guests',
} as const;

export function toSearchQueryParams(criteria: StaySearchCriteria): Record<string, string> {
  return {
    [SEARCH_QUERY_PARAMS.checkIn]: criteria.checkIn,
    [SEARCH_QUERY_PARAMS.checkOut]: criteria.checkOut,
    [SEARCH_QUERY_PARAMS.guests]: serializeGuests(criteria.rooms),
  };
}

/**
 * Rebuilds a search from URL parameters. Only the format is checked here; business rules
 * (date in the past, maximum length…) are checked by `validateStaySearch`.
 */
export function fromSearchQueryParams(
  read: (name: string) => string | null,
): StaySearchCriteria | null {
  const checkIn = read(SEARCH_QUERY_PARAMS.checkIn);
  const checkOut = read(SEARCH_QUERY_PARAMS.checkOut);
  const guests = read(SEARCH_QUERY_PARAMS.guests);
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || guests === null || checkOut <= checkIn) {
    return null;
  }
  const rooms = parseGuests(guests);
  return rooms ? { checkIn, checkOut, rooms } : null;
}
