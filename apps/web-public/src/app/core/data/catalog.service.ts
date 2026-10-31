import { Injectable } from '@angular/core';
import type { AmenityCode, BookingRules, HotelInfo, HotelServiceCode, Locale } from '@riad/shared';
import { injectLocale } from '../i18n/locale';
import {
  AMENITY_LABELS,
  DEMO_BOOKING_RULES,
  DEMO_HOTEL,
  DEMO_REVIEWS,
  DEMO_ROOM_CATEGORIES,
  DEMO_SERVICES,
} from './demo-catalog.data';

/** A room category ready to display, in the current language. */
export interface CategoryView {
  code: string;
  name: string;
  description: string;
  beds: string;
  maxOccupancy: number;
  areaSqm: number;
  amenities: { code: AmenityCode; label: string }[];
  /** Lowest possible price per night: non-refundable rate, low season. */
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

/**
 * Single source of the hotel catalogue for every screen.
 * Today it reads the demo data; when the API is ready, only this service will change.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly locale: Locale = injectLocale();

  readonly hotel: HotelInfo = DEMO_HOTEL;
  readonly bookingRules: BookingRules = DEMO_BOOKING_RULES;
  readonly address: string = DEMO_HOTEL.address[this.locale];

  readonly categories: CategoryView[] = DEMO_ROOM_CATEGORIES.map((category) => ({
    code: category.code,
    name: category.name[this.locale],
    description: category.description[this.locale],
    beds: category.beds[this.locale],
    maxOccupancy: category.maxOccupancy,
    areaSqm: category.areaSqm,
    amenities: category.amenities.map((code) => ({
      code,
      label: AMENITY_LABELS[code][this.locale],
    })),
    fromPriceCents: Math.round(
      (category.basePriceCents * (100 - DEMO_BOOKING_RULES.nonRefundableDiscountPercent)) / 100,
    ),
  }));

  readonly services: ServiceView[] = DEMO_SERVICES.map((service) => ({
    code: service.code,
    name: service.name[this.locale],
    detail: service.detail[this.locale],
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
  readonly totalRooms: number = DEMO_ROOM_CATEGORIES.reduce(
    (total, category) => total + category.roomCount,
    0,
  );
}
