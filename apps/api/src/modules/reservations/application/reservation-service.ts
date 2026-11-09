import { createHash, randomInt } from 'node:crypto';
import type { Sequelize, Transaction } from 'sequelize';
import {
  AppError,
  ConflictError,
  type FieldError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import { HotelNotConfiguredError } from '../../catalog/application/public-catalog.ts';
import { CatalogRepository } from '../../catalog/infrastructure/catalog-repository.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { countedGuests, fitsIn, nightsOf, type Occupancy, quoteRoom } from '../domain/quote.ts';
import {
  freeCancellationUntil,
  newReference,
  nightLabel,
  type RatePlan,
  type ReservationSource,
  serviceQuantity,
} from '../domain/reservation-rules.ts';
import { stayDateErrors } from '../domain/stay-rules.ts';
import { AvailabilityRepository } from '../infrastructure/availability-repository.ts';
import {
  type CustomerFields,
  type CustomerView,
  type NewCharge,
  type NewReservationRoom,
  type ReservationDetail,
  type ReservationFilter,
  ReservationRepository,
  type ReservationSummary,
} from '../infrastructure/reservation-repository.ts';

export interface ActionOrigin {
  ip: string | undefined;
}

export interface RequestedRoom extends Occupancy {
  categoryId: string;
  babyCot: boolean;
}

export interface RequestedService {
  serviceId: string;
  /** Only for a service « per unit »; ignored otherwise. */
  quantity: number;
}

export interface NewBooking {
  checkIn: string;
  checkOut: string;
  ratePlan: RatePlan;
  source: ReservationSource;
  rooms: RequestedRoom[];
  services: RequestedService[];
  /** An existing customer, or the details of a new one. */
  customer: { id: string } | CustomerFields;
  customerMessage: string | null;
  internalNotes: string | null;
}

/** Who makes a booking: a staff member, or a visitor on the website (no account). */
export type BookingAuthor = { kind: 'staff'; user: StaffUser } | { kind: 'website' };

/** A booking waiting for its payment: its rooms are held until then (RM-05). */
export interface BookingHold {
  paymentExpiresAt: Date;
}

export interface BookedReservation {
  id: string;
  reference: string;
  /** Rooms, services and tourist tax. */
  totalCents: number;
  touristTaxCents: number;
}

/** The answer of a creation: replayed as is when the same request comes again. */
export interface BookingResult {
  status: number;
  replayed: boolean;
  reservation: ReservationDetail;
}

const IDEMPOTENCY_SCOPE = 'admin.reservation.create';
const UNIQUE_VIOLATION = '23505';

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const parent = (error as { parent?: { code?: unknown } }).parent;
  return typeof parent?.code === 'string' ? parent.code : undefined;
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** « 12 mai » for the messages. */
function dayText(date: string): string {
  return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
      title: 'Requête déjà utilisée',
      detail: 'Cette clé a déjà servi pour une autre demande. Rechargez la page puis réessayez.',
    });
  }
}

/**
 * Reservations taken by the staff (phone or desk): creation, list, detail. A creation runs in
 * one transaction which locks the requested categories, checks the availability again
 * (RM-02, RM-03), freezes the price of each night (RM-14), adds the services and the tourist
 * tax, then writes the audit log: if one step fails, nothing is kept.
 */
export class ReservationService {
  readonly #sequelize: Sequelize;
  readonly #repository: ReservationRepository;
  readonly #availability: AvailabilityRepository;
  readonly #catalog: CatalogRepository;
  readonly #today: () => string;

  /** `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. */
  constructor(sequelize: Sequelize, today: () => string) {
    this.#sequelize = sequelize;
    this.#repository = new ReservationRepository(sequelize);
    this.#availability = new AvailabilityRepository(sequelize);
    this.#catalog = new CatalogRepository(sequelize);
    this.#today = today;
  }

  async create(
    actor: StaffUser,
    booking: NewBooking,
    idempotencyKey: string,
    origin: ActionOrigin,
  ): Promise<BookingResult> {
    const errors = stayDateErrors(booking.checkIn, booking.checkOut, this.#today());
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
    const requestHash = createHash('sha256').update(JSON.stringify(booking)).digest('hex');
    const replay = await this.#replay(idempotencyKey, requestHash);
    if (replay !== undefined) {
      return replay;
    }
    try {
      const reservation = await this.#sequelize.transaction(async (transaction) => {
        await this.#repository.claimIdempotencyKey(
          idempotencyKey,
          IDEMPOTENCY_SCOPE,
          requestHash,
          transaction,
        );
        const author = { kind: 'staff', user: actor } as const;
        const booked = await this.book(author, booking, origin, transaction);
        const detail = await this.#found(booked.id, transaction);
        await this.#repository.storeIdempotentResponse(idempotencyKey, 201, detail, transaction);
        return detail;
      });
      return { status: 201, replayed: false, reservation };
    } catch (error) {
      // The same key sent twice at the same moment: the second request waited for the first.
      if (postgresCode(error) === UNIQUE_VIOLATION) {
        const again = await this.#replay(idempotencyKey, requestHash);
        if (again !== undefined) {
          return again;
        }
      }
      throw error;
    }
  }

  /** The stored answer of a request already made with this key, if any. */
  async #replay(key: string, requestHash: string): Promise<BookingResult | undefined> {
    const stored = await this.#repository.findIdempotencyKey(key);
    if (stored === undefined || stored.status === null) {
      return undefined;
    }
    if (stored.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError();
    }
    return {
      status: stored.status,
      replayed: true,
      reservation: stored.body as ReservationDetail,
    };
  }

  /**
   * Writes a booking inside the caller's transaction, after checking it again with the
   * categories locked. Shared by the staff (confirmed at once) and the website (`hold`: waiting
   * for the payment).
   */
  async book(
    author: BookingAuthor,
    booking: NewBooking,
    origin: ActionOrigin,
    transaction: Transaction,
    hold?: BookingHold,
  ): Promise<BookedReservation> {
    const staffId = author.kind === 'staff' ? author.user.id : null;
    const { checkIn, checkOut } = booking;
    const settings = await this.#repository.bookingSettings(transaction);
    if (settings === undefined) {
      throw new HotelNotConfiguredError();
    }

    // 1. The categories, locked: a concurrent booking of the same category waits here.
    const categoryIds = [...new Set(booking.rooms.map((room) => room.categoryId))];
    const locked = await this.#repository.lockCategories(categoryIds, transaction);
    const categories = new Map(locked.map((category) => [category.id, category]));
    const problems: FieldError[] = [];
    booking.rooms.forEach((room, index) => {
      const category = categories.get(room.categoryId);
      if (category === undefined || !category.isActive) {
        problems.push({ field: `rooms[${index}].categoryId`, message: 'Catégorie inconnue.' });
      } else if (!fitsIn(category, room)) {
        // Probe P1 of the QA audit: never more guests than the category holds (RM-07).
        const most = category.maxOccupancy;
        const message = `${most} personne(s) au plus dans cette catégorie (bébé non compté).`;
        problems.push({ field: `rooms[${index}]`, message });
      }
    });
    const services = await this.#repository.activeServices(
      booking.services.map((service) => service.serviceId),
      transaction,
    );
    booking.services.forEach((requested, index) => {
      if (!services.some((service) => service.id === requested.serviceId)) {
        problems.push({ field: `services[${index}].serviceId`, message: 'Prestation inconnue.' });
      }
    });
    const customer = await this.#customerOf(booking.customer, transaction);
    if (customer === undefined) {
      problems.push({ field: 'customer.id', message: 'Client inconnu.' });
    }
    if (problems.length > 0 || customer === undefined) {
      throw new ValidationError(problems);
    }

    // 2. Open to sale and enough rooms on every night, counted with the locks held.
    const closed = await this.#availability.closedCategoryIds(checkIn, checkOut, transaction);
    for (const categoryId of categoryIds) {
      if (closed.has(categoryId)) {
        const name = categories.get(categoryId)?.name ?? '';
        throw new ConflictError(
          'CATEGORY_CLOSED',
          'Catégorie fermée à la vente',
          `« ${name} » est fermée à la vente sur ces dates : rouvrez la vente d’abord.`,
        );
      }
    }
    const free = await this.#availability.freeRoomsByNight(checkIn, checkOut, transaction);
    for (const categoryId of categoryIds) {
      const wanted = booking.rooms.filter((room) => room.categoryId === categoryId).length;
      const short = free.find((row) => row.categoryId === categoryId && row.free < wanted);
      if (short !== undefined) {
        const name = categories.get(categoryId)?.name ?? '';
        throw new ConflictError(
          'NOT_AVAILABLE',
          'Plus assez de chambres',
          `Il reste ${Math.max(0, short.free)} chambre(s) « ${name} » la nuit du ` +
            `${dayText(short.night)} : ${wanted} demandée(s).`,
        );
      }
    }

    // 3. Prices of the nights, frozen with the reservation (RM-14).
    const periods = await this.#catalog.listRatePeriods(checkIn, checkOut);
    const rooms: NewReservationRoom[] = booking.rooms.map((room) => {
      const category = categories.get(room.categoryId);
      if (category === undefined) {
        throw new Error('catégorie vérifiée plus haut');
      }
      const quote = quoteRoom({ category, periods, checkIn, checkOut, occupancy: room, settings });
      const flexible = booking.ratePlan === 'flexible';
      const nights = quote.nights.map((night) => ({
        night: night.night,
        priceCents: flexible ? night.flexibleCents : night.nonRefundableCents,
        rateLabel: nightLabel(night.adjustmentPct),
      }));
      return {
        categoryId: room.categoryId,
        adults: room.adults,
        childrenAges: room.childrenAges,
        babyCot: room.babyCot,
        subtotalCents: nights.reduce((sum, night) => sum + night.priceCents, 0),
        nights,
      };
    });

    // 4. Services over the whole stay, and the tourist tax on its own line (RM-12, RM-13).
    const nightCount = nightsOf(checkIn, checkOut).length;
    const guests = booking.rooms.reduce((sum, room) => sum + countedGuests(room), 0);
    const adults = booking.rooms.reduce((sum, room) => sum + room.adults, 0);
    const charges: NewCharge[] = booking.services.map((requested) => {
      const service = services.find((item) => item.id === requested.serviceId);
      if (service === undefined) {
        throw new Error('prestation vérifiée plus haut');
      }
      const quantity = serviceQuantity(service.pricingUnit, {
        guests,
        nights: nightCount,
        units: requested.quantity,
      });
      return {
        kind: 'service',
        serviceId: service.id,
        label: service.name,
        quantity,
        unitPriceCents: service.unitPriceCents,
        vatRate: service.vatRate,
        totalCents: quantity * service.unitPriceCents,
      };
    });
    if (settings.touristTaxCentsPerAdultNight > 0) {
      const quantity = adults * nightCount;
      charges.push({
        kind: 'tourist_tax',
        serviceId: null,
        label: 'Taxe de séjour',
        quantity,
        unitPriceCents: settings.touristTaxCentsPerAdultNight,
        vatRate: 0,
        totalCents: quantity * settings.touristTaxCentsPerAdultNight,
      });
    }
    const totalCents =
      rooms.reduce((sum, room) => sum + room.subtotalCents, 0) +
      charges.reduce((sum, charge) => sum + charge.totalCents, 0);

    // 5. Writing, then the audit log.
    const reference = await this.#freeReference(transaction);
    const reservationId = await this.#repository.insertReservation(
      {
        reference,
        customerId: customer.id,
        source: booking.source,
        checkIn,
        checkOut,
        ratePlan: booking.ratePlan,
        totalCents,
        freeCancellationUntil: freeCancellationUntil({
          ratePlan: booking.ratePlan,
          checkIn,
          checkInTime: settings.checkInTime,
          freeCancellationHours: settings.freeCancellationHours,
        }),
        customerMessage: booking.customerMessage,
        internalNotes: booking.internalNotes,
        createdBy: staffId,
        paymentExpiresAt: hold?.paymentExpiresAt ?? null,
      },
      transaction,
    );
    for (const room of rooms) {
      await this.#repository.insertRoom(reservationId, room, transaction);
    }
    for (const charge of charges) {
      await this.#repository.insertCharge(reservationId, charge, staffId, transaction);
    }
    await recordAudit(
      this.#sequelize,
      {
        ...(staffId === null
          ? { actorType: 'system' as const }
          : { actorType: 'staff' as const, actorUserId: staffId }),
        action: 'reservation.created',
        entityType: 'reservation',
        entityId: reservationId,
        changes: {
          reference,
          source: booking.source,
          checkIn,
          checkOut,
          ratePlan: booking.ratePlan,
          rooms: rooms.length,
          totalCents,
          customerId: customer.id,
          ...(hold === undefined ? {} : { paymentExpiresAt: hold.paymentExpiresAt }),
        },
        ipAddress: origin.ip,
      },
      transaction,
    );
    const touristTaxCents = charges
      .filter((charge) => charge.kind === 'tourist_tax')
      .reduce((sum, charge) => sum + charge.totalCents, 0);
    return { id: reservationId, reference, totalCents, touristTaxCents };
  }

  /**
   * The existing customer (undefined when unknown or anonymized), or the new one, created in
   * the same transaction: if the booking fails, the customer is not kept either.
   */
  async #customerOf(
    customer: NewBooking['customer'],
    transaction: Transaction,
  ): Promise<CustomerView | undefined> {
    if ('id' in customer) {
      return this.#repository.findCustomer(customer.id, transaction);
    }
    const id = await this.#repository.insertCustomer(customer, transaction);
    return { id, ...customer };
  }

  /** A reference not used yet; a collision is very unlikely (32⁸ combinations). */
  async #freeReference(transaction: Transaction): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = newReference((size) => randomInt(size));
      if (!(await this.#repository.referenceExists(reference, transaction))) {
        return reference;
      }
    }
    throw new Error('aucune référence libre après 5 tirages');
  }

  async #found(id: string, transaction?: Transaction): Promise<ReservationDetail> {
    const detail = await this.#repository.detail(id, transaction);
    if (detail === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    return detail;
  }

  detail(id: string): Promise<ReservationDetail> {
    return this.#found(id);
  }

  /** By default the coming arrivals; a search, or a period asked, looks at every date. */
  list(filter: ReservationFilter): Promise<{ items: ReservationSummary[]; total: number }> {
    const everyDate = filter.q !== undefined || filter.arrivalTo !== undefined;
    const arrivalFrom = filter.arrivalFrom ?? (everyDate ? undefined : this.#today());
    return this.#repository.list({ ...filter, arrivalFrom });
  }

  searchCustomers(text: string): Promise<CustomerView[]> {
    return this.#repository.searchCustomers(text);
  }
}
