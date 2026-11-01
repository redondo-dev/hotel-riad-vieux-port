/**
 * Hotel catalogue types. They mirror the API resources described in the architecture
 * document (`GET /api/v1/public/hotel`, `/room-categories`, `/services`), so the
 * Angular screens built today on demo data will keep working once the API is plugged in.
 */

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** A text available in every supported language. */
export type LocalizedText = Record<Locale, string>;

export type AmenityCode =
  | 'wifi'
  | 'air-conditioning'
  | 'tv'
  | 'safe'
  | 'hair-dryer'
  | 'shower'
  | 'bathtub'
  | 'sitting-area'
  | 'port-view';

export interface RoomCategory {
  /** Stable identifier used in URLs, for example `double-standard`. */
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  beds: LocalizedText;
  /** Maximum number of guests, babies under 2 in a cot excluded. */
  maxOccupancy: number;
  /** Number of guests included in the base price. */
  baseOccupancy: number;
  areaSqm: number;
  roomCount: number;
  /** Base price per night, flexible rate, low season, in euro cents. */
  basePriceCents: number;
  amenities: AmenityCode[];
}

export type HotelServiceCode =
  'breakfast' | 'restaurant-bar' | 'reception-24h' | 'baby-cot' | 'wifi' | 'air-conditioning';

export interface HotelService {
  code: HotelServiceCode;
  name: LocalizedText;
  detail: LocalizedText;
}

export interface HotelInfo {
  name: string;
  address: LocalizedText;
  phone: {
    /** Number as displayed, for example `04 65 71 00 00`. */
    display: string;
    /** Number in international format for `tel:` links, for example `+33465710000`. */
    international: string;
  };
  email: string;
  /** Local time `HH:mm`. */
  checkInFrom: string;
  /** Local time `HH:mm`. */
  checkOutBefore: string;
  timeZone: string;
}

/** Online booking rules (business rules RM-06, RM-11, RM-15), set by the management. */
export interface BookingRules {
  maxStayNights: number;
  bookingHorizonDays: number;
  /** Same-day arrivals can be booked online until this time, in minutes after midnight. */
  sameDayCutoffMinutes: number;
  nonRefundableDiscountPercent: number;
  freeCancellationHours: number;
}

export interface DemoReview {
  id: string;
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: LocalizedText;
  categoryCode: string;
}
