/**
 * Hotel catalogue types. They mirror the public API resources (`GET /api/v1/public/hotel`,
 * `/room-categories`, `/services`, see apps/api/openapi/openapi.yaml), read by the server of
 * the public site and handed to the Angular screens.
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
  /** Base price per night, flexible rate, without season or event, in euro cents. */
  basePriceCents: number;
  /** Supplement per night for each adult or child above the base occupancy, in euro cents. */
  extraAdultCents: number;
  extraChildCents: number;
  /** Lowest price of a night bookable online now, non-refundable rate, in euro cents. */
  fromPriceCents: number;
  /** Equipment codes; a code unknown to the site is simply not displayed. */
  amenities: string[];
}

export type HotelServiceCode =
  'breakfast' | 'restaurant-bar' | 'reception-24h' | 'baby-cot' | 'wifi' | 'air-conditioning';

/** A highlight of the hotel shown on the home page (static content of the site). */
export interface HotelService {
  code: HotelServiceCode;
  name: LocalizedText;
  detail: LocalizedText;
}

export interface HotelInfo {
  name: string;
  /** A postal address is not translated: the same text in every language. */
  address: string;
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

export type PricingUnit = 'per_person_night' | 'per_night' | 'per_stay' | 'per_unit';

/** An option guests can add when booking online (breakfast, baby cot…), price including VAT. */
export interface HotelOption {
  code: string;
  name: LocalizedText;
  unitPriceCents: number;
  pricingUnit: PricingUnit;
}

/**
 * Everything the public site needs from the catalogue, read from the API by the server of the
 * site and handed to the pages. `fetchedAt` (ISO date-time) tells how fresh it is.
 */
export interface CatalogSnapshot {
  hotel: HotelInfo;
  bookingRules: BookingRules;
  categories: RoomCategory[];
  options: HotelOption[];
  fetchedAt: string;
}
