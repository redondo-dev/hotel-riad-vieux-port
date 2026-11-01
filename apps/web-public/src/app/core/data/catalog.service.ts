import { Injectable } from '@angular/core';
import type {
  AmenityCode,
  BookingRules,
  CatalogSnapshot,
  HotelInfo,
  HotelOption,
  HotelService,
  HotelServiceCode,
  LocalizedText,
  Locale,
  PricingUnit,
} from '@riad/shared';
import { formatPrice } from '../i18n/format';
import { injectLocale } from '../i18n/locale';
import { readCatalogSnapshot } from './catalog-snapshot';
import { DEMO_REVIEWS } from './demo-reviews.data';
import { AMENITY_LABELS, HOTEL_HIGHLIGHTS } from './hotel-content';

/** A room category ready to display, in the current language. */
export interface CategoryView {
  code: string;
  name: string;
  description: string;
  beds: string;
  maxOccupancy: number;
  areaSqm: number;
  amenities: { code: AmenityCode; label: string }[];
  /** Lowest price of a night bookable online now, non-refundable rate (computed by the API). */
  fromPriceCents: number;
}

export interface ServiceView {
  code: HotelServiceCode;
  name: string;
  detail: string;
}

export interface ReviewView {
  id: string;
  author: string;
  rating: number;
  text: string;
  categoryName: string;
}

const UNIT_TEXTS: Record<PricingUnit, LocalizedText> = {
  per_person_night: { fr: 'par personne et par nuit', en: 'per person per night' },
  per_night: { fr: 'par nuit', en: 'per night' },
  per_stay: { fr: 'par séjour', en: 'per stay' },
  per_unit: { fr: 'l’unité', en: 'each' },
};

/** Used only while the site is unavailable: no page displays these values then. */
const NO_HOTEL: HotelInfo = {
  name: 'Hôtel Riad Vieux-Port',
  address: '',
  phone: { display: '', international: '' },
  email: '',
  checkInFrom: '15:00',
  checkOutBefore: '12:00',
  timeZone: 'Europe/Paris',
};

const NO_RULES: BookingRules = {
  maxStayNights: 30,
  bookingHorizonDays: 365,
  sameDayCutoffMinutes: 23 * 60,
  nonRefundableDiscountPercent: 0,
  freeCancellationHours: 48,
};

function isAmenityCode(code: string): code is AmenityCode {
  return Object.hasOwn(AMENITY_LABELS, code);
}

/** « Buffet sucré et salé. 14 € par personne et par nuit. » when the option is sold. */
function highlightDetail(
  highlight: HotelService,
  options: readonly HotelOption[],
  locale: Locale,
): string {
  const detail = highlight.detail[locale];
  const option = options.find((item) => item.code === highlight.code);
  if (option === undefined || option.unitPriceCents === 0) {
    return detail;
  }
  const price = formatPrice(option.unitPriceCents, locale);
  return `${detail} ${price} ${UNIT_TEXTS[option.pricingUnit][locale]}.`;
}

/**
 * Single source of the hotel catalogue for every screen: the data of the API, read by the
 * server of the site (see catalog-snapshot.ts), in the current language. When the site has no
 * catalogue (`available` false), the root component shows the « unavailable » page instead.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly locale: Locale = injectLocale();
  private readonly snapshot: CatalogSnapshot | null = readCatalogSnapshot();

  readonly available: boolean = this.snapshot !== null;
  readonly hotel: HotelInfo = this.snapshot?.hotel ?? NO_HOTEL;
  readonly bookingRules: BookingRules = this.snapshot?.bookingRules ?? NO_RULES;
  readonly address: string = this.hotel.address;

  readonly categories: CategoryView[] = (this.snapshot?.categories ?? []).map((category) => ({
    code: category.code,
    name: category.name[this.locale],
    description: category.description[this.locale],
    beds: category.beds[this.locale],
    maxOccupancy: category.maxOccupancy,
    areaSqm: category.areaSqm,
    amenities: category.amenities.filter(isAmenityCode).map((code) => ({
      code,
      label: AMENITY_LABELS[code][this.locale],
    })),
    fromPriceCents: category.fromPriceCents,
  }));

  readonly services: ServiceView[] = HOTEL_HIGHLIGHTS.map((highlight) => ({
    code: highlight.code,
    name: highlight.name[this.locale],
    detail: highlightDetail(highlight, this.snapshot?.options ?? [], this.locale),
  }));

  readonly reviews: ReviewView[] = DEMO_REVIEWS.map((review) => ({
    id: review.id,
    author: review.author,
    rating: review.rating,
    text: review.text[this.locale],
    categoryName:
      this.categories.find((category) => category.code === review.categoryCode)?.name ?? '',
  }));

  /** Total number of rooms, computed from the categories rather than written separately. */
  readonly totalRooms: number = (this.snapshot?.categories ?? []).reduce(
    (total, category) => total + category.roomCount,
    0,
  );
}
