import { AppError } from '../../../shared/domain/errors.ts';
import { displayPhone, hoursAndMinutes, minutesAfterMidnight } from '../domain/hotel-info.ts';
import { type PhotoSource, photoSources } from '../domain/photo-rules.ts';
import { HOTEL_TIME_ZONE, addDays, fromPriceCents } from '../domain/pricing.ts';
import type {
  CatalogRepository,
  HotelSettingsRecord,
  LocalizedText,
} from '../infrastructure/catalog-repository.ts';
import type { PhotoRepository } from '../infrastructure/photo-repository.ts';

/**
 * What the public site may know about the catalogue. Nothing internal leaves this layer: no
 * database identifier, no inactive category, no room number, no VAT rate.
 */

export interface PublicHotel {
  name: string;
  /** A postal address is not translated: the same text in every language. */
  address: string;
  phone: { display: string; international: string };
  email: string;
  checkInFrom: string;
  checkOutBefore: string;
  timeZone: string;
  bookingRules: {
    maxStayNights: number;
    bookingHorizonDays: number;
    sameDayCutoffMinutes: number;
    nonRefundableDiscountPercent: number;
    freeCancellationHours: number;
  };
}

export interface PublicCategory {
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  beds: LocalizedText;
  maxOccupancy: number;
  baseOccupancy: number;
  areaSqm: number;
  roomCount: number;
  amenities: string[];
  /** Flexible rate, one night without any rate period. */
  basePriceCents: number;
  extraAdultCents: number;
  extraChildCents: number;
  /** Lowest price of a night that can be booked online now, non-refundable rate. */
  fromPriceCents: number;
  /** In display order: the first one is the main photo. Empty while none is chosen. */
  photos: PublicPhoto[];
}

export interface PublicPhoto {
  alt: LocalizedText;
  width: number | null;
  height: number | null;
  /** WebP, 400, 800 and 1600 pixels wide (a « srcset »). */
  sources: PhotoSource[];
}

export interface PublicService {
  code: string;
  name: LocalizedText;
  unitPriceCents: number;
  pricingUnit: 'per_person_night' | 'per_night' | 'per_stay' | 'per_unit';
}

export class HotelNotConfiguredError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'HOTEL_NOT_CONFIGURED',
      title: 'Service indisponible',
      detail: 'Les informations de l’hôtel sont momentanément indisponibles.',
    });
  }
}

export class PublicCatalog {
  readonly #repository: CatalogRepository;
  readonly #today: () => string;
  readonly #photos: PhotoRepository | undefined;

  /**
   * `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. Without
   * `photos`, the categories are given without photos.
   */
  constructor(repository: CatalogRepository, today: () => string, photos?: PhotoRepository) {
    this.#repository = repository;
    this.#today = today;
    this.#photos = photos;
  }

  async #photosByCategory(): Promise<Map<string, PublicPhoto[]>> {
    const byCategory = new Map<string, PublicPhoto[]>();
    for (const photo of (await this.#photos?.ofActiveCategories()) ?? []) {
      const { alt, width, height } = photo;
      const photos = byCategory.get(photo.categoryId) ?? [];
      photos.push({ alt, width, height, sources: photoSources(photo.id) });
      byCategory.set(photo.categoryId, photos);
    }
    return byCategory;
  }

  async #settings(): Promise<HotelSettingsRecord> {
    const settings = await this.#repository.findHotelSettings();
    if (settings === undefined) {
      throw new HotelNotConfiguredError();
    }
    return settings;
  }

  async hotel(): Promise<PublicHotel> {
    const settings = await this.#settings();
    return {
      name: settings.name,
      address: settings.address,
      phone: { display: displayPhone(settings.phone), international: settings.phone },
      email: settings.email,
      checkInFrom: hoursAndMinutes(settings.checkInTime),
      checkOutBefore: hoursAndMinutes(settings.checkOutTime),
      timeZone: HOTEL_TIME_ZONE,
      bookingRules: {
        maxStayNights: settings.onlineMaxStayNights,
        bookingHorizonDays: settings.onlineBookingHorizonDays,
        sameDayCutoffMinutes: minutesAfterMidnight(settings.sameDayCutoffTime),
        nonRefundableDiscountPercent: settings.nonRefundableDiscountPct,
        freeCancellationHours: settings.freeCancellationHours,
      },
    };
  }

  async categories(): Promise<PublicCategory[]> {
    const settings = await this.#settings();
    // The « from » price looks at every night that can be booked online from today.
    const firstNight = this.#today();
    const nightCount = settings.onlineBookingHorizonDays;
    const [categories, periods, photos] = await Promise.all([
      this.#repository.listPublicCategories(),
      this.#repository.listRatePeriods(firstNight, addDays(firstNight, nightCount)),
      this.#photosByCategory(),
    ]);
    return categories.map(({ id, ...category }) => ({
      ...category,
      photos: photos.get(id) ?? [],
      fromPriceCents: fromPriceCents({
        basePriceCents: category.basePriceCents,
        categoryId: id,
        periods,
        firstNight,
        nightCount,
        nonRefundableDiscountPct: settings.nonRefundableDiscountPct,
      }),
    }));
  }

  async services(): Promise<PublicService[]> {
    return this.#repository.listOnlineServices();
  }
}
