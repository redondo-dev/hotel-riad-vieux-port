import type { PricingUnit } from '../catalog/catalog-model';
import type { RatePlan } from './reservation-model';

/**
 * The booking form of the staff (phone or desk): what the API answers about availability and
 * the pure rules of the form. The API checks everything again when the booking is created.
 */

export interface Occupancy {
  adults: number;
  childrenAges: number[];
}

/** Price of the stay in one requested room; `fits: false` alone when the guests do not fit. */
export interface RoomOffer {
  fits: boolean;
  flexibleCents?: number;
  nonRefundableCents?: number;
  touristTaxCents?: number;
}

export interface CategoryAvailability {
  id: string;
  code: string;
  name: string;
  maxOccupancy: number;
  baseOccupancy: number;
  /** Rooms left on every night of the stay. */
  freeRooms: number;
  closed: boolean;
  /** One offer per requested room, in the order of the request. */
  offers: RoomOffer[];
}

export interface AvailabilityAnswer {
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: Occupancy[];
  categories: CategoryAvailability[];
}

export interface CustomerChoice {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredLanguage: 'fr' | 'en';
}

/** A baby (0 or 1) sleeps in a cot: not counted in the capacity, breakfast free (RM-10, RM-12). */
const INFANT_MAX_AGE = 1;

/**
 * The guests as the addresses of the API write them: one block per room separated by « _ »,
 * in each block the adults then the ages of the children: « 2-6-3_2 ».
 */
export function serializeGuests(rooms: readonly Occupancy[]): string {
  return rooms.map((room) => [room.adults, ...room.childrenAges].join('-')).join('_');
}

/** Why a category cannot be chosen for one room, or null when it can. */
export function unavailableReason(
  category: CategoryAvailability,
  roomIndex: number,
): string | null {
  if (category.closed) {
    return 'Fermée à la vente';
  }
  if (category.offers[roomIndex]?.fits !== true) {
    return 'Capacité dépassée';
  }
  return category.freeRooms === 0 ? 'Complet' : null;
}

/** Price of one room at the chosen rate, or null when the category does not fit. */
export function roomPrice(offer: RoomOffer | undefined, ratePlan: RatePlan): number | null {
  if (offer?.fits !== true) {
    return null;
  }
  const price = ratePlan === 'flexible' ? offer.flexibleCents : offer.nonRefundableCents;
  return price ?? null;
}

function countedGuests(room: Occupancy): number {
  return room.adults + room.childrenAges.filter((age) => age > INFANT_MAX_AGE).length;
}

/** Quantity of a service over the whole stay, as the API counts it. */
export function serviceQuantity(
  unit: PricingUnit,
  rooms: readonly Occupancy[],
  nights: number,
  units: number,
): number {
  switch (unit) {
    case 'per_person_night':
      return rooms.reduce((sum, room) => sum + countedGuests(room), 0) * nights;
    case 'per_night':
      return nights;
    case 'per_stay':
      return 1;
    case 'per_unit':
      return units;
  }
}

/**
 * Rooms chosen, at the chosen rate, plus the tourist tax of each room. null while a room has
 * no category, or the category chosen does not fit.
 */
export function roomsTotal(
  answer: AvailabilityAnswer,
  choices: readonly (string | null)[],
  ratePlan: RatePlan,
): { roomsCents: number; touristTaxCents: number } | null {
  let roomsCents = 0;
  let touristTaxCents = 0;
  for (let index = 0; index < answer.rooms.length; index += 1) {
    const category = answer.categories.find((item) => item.id === choices[index]);
    const offer = category?.offers[index];
    const price = roomPrice(offer, ratePlan);
    if (price === null) {
      return null;
    }
    roomsCents += price;
    touristTaxCents += offer?.touristTaxCents ?? 0;
  }
  return { roomsCents, touristTaxCents };
}
