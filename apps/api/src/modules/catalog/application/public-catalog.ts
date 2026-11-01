import { AppError } from '../../../shared/domain/errors.ts';
import { displayPhone, hoursAndMinutes, minutesAfterMidnight } from '../domain/hotel-info.ts';
import { HOTEL_TIME_ZONE, addDays, fromPriceCents } from '../domain/pricing.ts';
import type {
  CatalogRepository,
  HotelSettingsRecord,
  LocalizedText,
} from '../infrastructure/catalog-repository.ts';

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

  /** `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. */
  constructor(repository: CatalogRepository, today: () => string) {
    this.#repository = repository;
    this.#today = today;
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
    const [categories, periods] = await Promise.all([
      this.#repository.listPublicCategories(),
      this.#repository.listRatePeriods(firstNight, addDays(firstNight, nightCount)),
    ]);
    return categories.map(({ id, ...category }) => ({
      ...category,
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
