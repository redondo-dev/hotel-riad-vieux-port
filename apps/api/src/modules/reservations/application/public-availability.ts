import type { Sequelize } from 'sequelize';
import { ValidationError } from '../../../shared/domain/errors.ts';
import { HotelNotConfiguredError } from '../../catalog/application/public-catalog.ts';
import { minutesAfterMidnight } from '../../catalog/domain/hotel-info.ts';
import { CatalogRepository } from '../../catalog/infrastructure/catalog-repository.ts';
import type { Occupancy } from '../domain/quote.ts';
import {
  hotelClock,
  onlineStayErrors,
  type PublicOffer,
  publicOffers,
} from '../domain/public-offer-rules.ts';
import { freeCancellationUntil } from '../domain/reservation-rules.ts';
import { AvailabilityService, type StayRequest } from './availability-service.ts';

/** What a visitor sees for a search (GET /public/availability). */
export interface PublicAvailabilityAnswer {
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: Occupancy[];
  /** End of the free cancellation at the flexible rate (RM-15), the same for every category. */
  freeCancellationUntil: string | null;
  /** In display order; empty when nothing can take the whole request. */
  offers: PublicOffer[];
}

/**
 * Availability and prices for visitors (step R-1): the staff availability (same count of the
 * rooms left, same prices), checked against the online rules and stripped of everything
 * internal. Nothing is held: the booking will check again inside its transaction (RM-03).
 */
export class PublicAvailability {
  readonly #availability: AvailabilityService;
  readonly #catalog: CatalogRepository;
  readonly #now: () => Date;

  /** `now` gives the current instant; the tests fix it. */
  constructor(sequelize: Sequelize, now: () => Date) {
    this.#now = now;
    this.#availability = new AvailabilityService(sequelize, () => hotelClock(this.#now()).date);
    this.#catalog = new CatalogRepository(sequelize);
  }

  async search(request: StayRequest): Promise<PublicAvailabilityAnswer> {
    const settings = await this.#catalog.findHotelSettings();
    if (settings === undefined) {
      throw new HotelNotConfiguredError();
    }
    const { checkIn, checkOut } = request;
    const errors = onlineStayErrors(checkIn, checkOut, hotelClock(this.#now()), {
      maxStayNights: settings.onlineMaxStayNights,
      bookingHorizonDays: settings.onlineBookingHorizonDays,
      sameDayCutoffMinutes: minutesAfterMidnight(settings.sameDayCutoffTime),
    });
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
    const answer = await this.#availability.search(request);
    const deadline = freeCancellationUntil({
      ratePlan: 'flexible',
      checkIn,
      checkInTime: settings.checkInTime,
      freeCancellationHours: settings.freeCancellationHours,
    });
    return {
      checkIn,
      checkOut,
      nights: answer.nights,
      rooms: answer.rooms,
      freeCancellationUntil: deadline?.toISOString() ?? null,
      offers: publicOffers(answer.categories),
    };
  }
}
