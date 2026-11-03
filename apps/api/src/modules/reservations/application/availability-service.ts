import type { Sequelize } from 'sequelize';
import { ValidationError } from '../../../shared/domain/errors.ts';
import { HotelNotConfiguredError } from '../../catalog/application/public-catalog.ts';
import { CatalogRepository } from '../../catalog/infrastructure/catalog-repository.ts';
import { fitsIn, nightsOf, type Occupancy, quoteRoom, type RoomQuote } from '../domain/quote.ts';
import { stayDateErrors } from '../domain/stay-rules.ts';
import { AvailabilityRepository } from '../infrastructure/availability-repository.ts';

export interface StayRequest {
  checkIn: string;
  checkOut: string;
  rooms: Occupancy[];
}

/** Price of the stay in one requested room, or the room does not fit in the category. */
export type RoomOffer = ({ fits: true } & RoomQuote) | { fits: false };

export interface CategoryAvailability {
  id: string;
  code: string;
  name: string;
  maxOccupancy: number;
  baseOccupancy: number;
  /** Rooms still to sell on EVERY night of the stay (the tightest night), never below 0. */
  freeRooms: number;
  freeRoomsByNight: { night: string; free: number }[];
  /** Closed to sale on at least one night (sales_closures); shown, the staff decides. */
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

/**
 * Availability and prices of a stay for the staff (GET /admin/availability): for each category,
 * the rooms left night by night (RM-02) and the price of each requested room at both rates.
 * Nothing is held: the booking itself checks again inside its transaction (RM-03).
 */
export class AvailabilityService {
  readonly #availability: AvailabilityRepository;
  readonly #catalog: CatalogRepository;
  readonly #today: () => string;

  /** `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. */
  constructor(sequelize: Sequelize, today: () => string) {
    this.#availability = new AvailabilityRepository(sequelize);
    this.#catalog = new CatalogRepository(sequelize);
    this.#today = today;
  }

  async search(request: StayRequest): Promise<AvailabilityAnswer> {
    const { checkIn, checkOut } = request;
    const errors = stayDateErrors(checkIn, checkOut, this.#today());
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
    const settings = await this.#availability.pricingSettings();
    if (settings === undefined) {
      throw new HotelNotConfiguredError();
    }
    const [categories, freeRows, closed, periods] = await Promise.all([
      this.#availability.categories(),
      this.#availability.freeRoomsByNight(checkIn, checkOut),
      this.#availability.closedCategoryIds(checkIn, checkOut),
      this.#catalog.listRatePeriods(checkIn, checkOut),
    ]);

    const byCategory = new Map<string, { night: string; free: number }[]>();
    for (const row of freeRows) {
      const nights = byCategory.get(row.categoryId) ?? [];
      nights.push({ night: row.night, free: row.free });
      byCategory.set(row.categoryId, nights);
    }

    const answer = categories.map((category): CategoryAvailability => {
      const freeRoomsByNight = byCategory.get(category.id) ?? [];
      const tightest = Math.min(...freeRoomsByNight.map((night) => night.free));
      return {
        id: category.id,
        code: category.code,
        name: category.name,
        maxOccupancy: category.maxOccupancy,
        baseOccupancy: category.baseOccupancy,
        freeRooms: Math.max(0, Number.isFinite(tightest) ? tightest : 0),
        freeRoomsByNight,
        closed: closed.has(category.id),
        offers: request.rooms.map((occupancy): RoomOffer => {
          if (!fitsIn(category, occupancy)) {
            return { fits: false };
          }
          const quote = quoteRoom({ category, periods, checkIn, checkOut, occupancy, settings });
          return { fits: true, ...quote };
        }),
      };
    });

    return {
      checkIn,
      checkOut,
      nights: nightsOf(checkIn, checkOut).length,
      rooms: request.rooms,
      categories: answer,
    };
  }
}
