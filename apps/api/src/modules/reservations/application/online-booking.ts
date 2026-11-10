import { createHash } from 'node:crypto';
import type { Sequelize } from 'sequelize';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import { HotelNotConfiguredError } from '../../catalog/application/public-catalog.ts';
import { minutesAfterMidnight } from '../../catalog/domain/hotel-info.ts';
import { CatalogRepository } from '../../catalog/infrastructure/catalog-repository.ts';
import {
  checkoutClosesAt,
  dueNowCents,
  holdUntil,
  isSiteAddress,
  type PublicBookingStatus,
  publicStatusOf,
  stayDescription,
  withBookingReference,
} from '../domain/online-booking-rules.ts';
import { hotelClock, onlineStayErrors } from '../domain/public-offer-rules.ts';
import type { Occupancy } from '../domain/quote.ts';
import type { RatePlan } from '../domain/reservation-rules.ts';
import {
  type OnlineBookingRecord,
  ReservationRepository,
} from '../infrastructure/reservation-repository.ts';
import type { CheckoutSession, PaymentGateway } from './payment-gateway.ts';
import type { ActionOrigin, BookedReservation, ReservationService } from './reservation-service.ts';

/** A booking sent by the public site (relayed by its server, step R-4). */
export interface OnlineBookingRequest {
  checkIn: string;
  checkOut: string;
  rooms: Occupancy[];
  /** Code of the category, as in the addresses of the site. */
  category: string;
  ratePlan: RatePlan;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    countryCode: string | null;
  };
  language: 'fr' | 'en';
  message: string | null;
  /** Pages of the public site the payment page sends the visitor back to. */
  successUrl: string;
  cancelUrl: string;
}

/** What the site needs to send the visitor to the payment page. */
export interface OnlineBookingAnswer {
  reference: string;
  checkoutUrl: string;
  /** End of the hold of the rooms (ISO instant). */
  paymentExpiresAt: string;
}

/** A booking of the website as its confirmation page shows it: no personal data. */
export interface OnlineBookingSummary {
  reference: string;
  status: PublicBookingStatus;
  checkIn: string;
  checkOut: string;
  /** Code of the category, as in the addresses of the site. */
  category: string | null;
  roomCount: number;
  ratePlan: RatePlan;
  /** Paid online (non-refundable rate), tourist tax apart. */
  paidOnlineCents: number;
  /** To pay at the hotel: the stay at the flexible rate, and the tourist tax. */
  dueAtHotelCents: number;
}

export interface OnlineBookingResult {
  replayed: boolean;
  answer: OnlineBookingAnswer;
}

export class PaymentNotConfiguredError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'PAYMENT_NOT_CONFIGURED',
      title: 'Paiement en ligne indisponible',
      detail: 'Le paiement en ligne n’est pas encore ouvert : réservez par téléphone.',
    });
  }
}

export class PaymentUnavailableError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'PAYMENT_UNAVAILABLE',
      title: 'Paiement momentanément indisponible',
      detail:
        'Le service de paiement ne répond pas. Rien n’a été réservé : réessayez dans quelques ' +
        'minutes ou appelez l’hôtel.',
    });
  }
}

const IDEMPOTENCY_SCOPE = 'public.booking.create';
const UNIQUE_VIOLATION = '23505';
/** Refusals of the staff booking that mean « no longer available » for a visitor. */
const GONE_CODES = new Set(['NOT_AVAILABLE', 'CATEGORY_CLOSED']);

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const parent = (error as { parent?: { code?: unknown } }).parent;
  return typeof parent?.code === 'string' ? parent.code : undefined;
}

function summaryOf(booking: OnlineBookingRecord): OnlineBookingSummary {
  const stayCents = booking.totalCents - booking.touristTaxCents;
  const paidOnline = booking.ratePlan === 'non_refundable' ? stayCents : 0;
  return {
    reference: booking.reference,
    status: publicStatusOf(booking.status),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    category: booking.categoryCode,
    roomCount: booking.roomCount,
    ratePlan: booking.ratePlan,
    paidOnlineCents: paidOnline,
    dueAtHotelCents: booking.totalCents - paidOnline,
  };
}

function noLongerAvailable(): ConflictError {
  return new ConflictError(
    'NO_LONGER_AVAILABLE',
    'Plus disponible',
    'Cette chambre vient d’être réservée pour ces dates. Revenez aux résultats pour en choisir ' +
      'une autre.',
  );
}

/**
 * A booking made by a visitor on the website (step R-3):
 *  1. the online rules, the dates and the guests are checked again (never trusted from the
 *     browser), with the price computed here;
 *  2. in one transaction, the reservation is written « waiting for its payment » and holds its
 *     rooms for 33 minutes (RM-05), exactly as a staff booking checks them (shared code);
 *  3. the Stripe page is opened; if Stripe fails, the rooms are given back at once and nothing
 *     stays booked.
 * The same Idempotency-Key sent again answers the same page: a double click books once.
 */
export class OnlineBooking {
  readonly #sequelize: Sequelize;
  readonly #reservations: ReservationService;
  readonly #repository: ReservationRepository;
  readonly #catalog: CatalogRepository;
  readonly #payments: PaymentGateway | undefined;
  readonly #siteUrl: string;
  readonly #now: () => Date;
  readonly #logError: (error: unknown) => void;

  constructor(options: {
    sequelize: Sequelize;
    reservations: ReservationService;
    /** Without it (no Stripe key in development), bookings answer 503. */
    payments: PaymentGateway | undefined;
    /** Address of the public site: the pages back from the payment must be on it. */
    siteUrl: string;
    now: () => Date;
    /** A failure of Stripe: written to the server log, never shown to the visitor. */
    logError?: (error: unknown) => void;
  }) {
    this.#sequelize = options.sequelize;
    this.#reservations = options.reservations;
    this.#repository = new ReservationRepository(options.sequelize);
    this.#catalog = new CatalogRepository(options.sequelize);
    this.#payments = options.payments;
    this.#siteUrl = options.siteUrl;
    this.#now = options.now;
    this.#logError = options.logError ?? (() => undefined);
  }

  async create(
    request: OnlineBookingRequest,
    idempotencyKey: string,
    origin: ActionOrigin,
  ): Promise<OnlineBookingResult> {
    const payments = this.#payments;
    if (payments === undefined) {
      throw new PaymentNotConfiguredError();
    }
    await this.#check(request);
    const category = await this.#repository.activeCategoryByCode(request.category);
    if (category === undefined) {
      throw new ValidationError([{ field: 'category', message: 'Catégorie inconnue.' }]);
    }

    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const replay = await this.#replay(idempotencyKey, requestHash);
    if (replay !== undefined) {
      return { replayed: true, answer: replay };
    }

    const now = this.#now();
    const paymentExpiresAt = holdUntil(now);
    const booked = await this.#hold(request, category.id, idempotencyKey, requestHash, origin, {
      paymentExpiresAt,
    });

    const nights = Math.round(
      (Date.parse(request.checkOut) - Date.parse(request.checkIn)) / 86_400_000,
    );
    const name = request.language === 'fr' ? category.nameFr : category.nameEn;
    const { customer } = request;
    let checkout: CheckoutSession;
    try {
      checkout = await payments.createCheckout({
        reservationId: booked.id,
        reference: booked.reference,
        mode: request.ratePlan === 'non_refundable' ? 'payment' : 'setup',
        amountCents: dueNowCents(request.ratePlan, booked.totalCents, booked.touristTaxCents),
        description: stayDescription(name, nights, request.language),
        customer: {
          email: customer.email,
          name: `${customer.firstName} ${customer.lastName}`,
          phone: customer.phone,
        },
        locale: request.language,
        expiresAt: checkoutClosesAt(now),
        successUrl: request.successUrl,
        cancelUrl: withBookingReference(request.cancelUrl, booked.reference),
      });
    } catch (error) {
      this.#logError(error);
      await this.#giveBack(booked.id, idempotencyKey);
      throw new PaymentUnavailableError();
    }

    const answer: OnlineBookingAnswer = {
      reference: booked.reference,
      checkoutUrl: checkout.url,
      paymentExpiresAt: paymentExpiresAt.toISOString(),
    };
    await this.#sequelize.transaction(async (transaction) => {
      await this.#repository.attachCheckout(
        booked.id,
        { sessionId: checkout.id, stripeCustomerId: checkout.customerId },
        transaction,
      );
      await this.#repository.storeIdempotentResponse(idempotencyKey, 201, answer, transaction);
    });
    return { replayed: false, answer };
  }

  /** For the confirmation page, from the identifier Stripe gives back to it. */
  async summary(sessionId: string): Promise<OnlineBookingSummary> {
    const booking = await this.#repository.onlineBooking({ sessionId });
    if (booking === undefined) {
      throw new NotFoundError('Cette réservation est introuvable.');
    }
    return summaryOf(booking);
  }

  /**
   * « ← Retour » on the payment page (decision « 3a » of step R-4): the page is closed and the
   * rooms are given back at once. Already paid meanwhile: nothing changes (the payment will
   * confirm the booking). Already over: answered as it is.
   */
  async abandon(reference: string, origin: ActionOrigin): Promise<OnlineBookingSummary> {
    const found = await this.#repository.onlineBooking({ reference });
    if (found === undefined) {
      throw new NotFoundError('Cette réservation est introuvable.');
    }
    if (found.status !== 'pending_payment') {
      return summaryOf(found);
    }
    const payments = this.#payments;
    if (payments === undefined) {
      throw new PaymentNotConfiguredError();
    }
    if (found.sessionId !== null) {
      let closed: 'expired' | 'already_complete';
      try {
        closed = await payments.expireCheckout(found.sessionId);
      } catch (error) {
        this.#logError(error);
        throw new PaymentUnavailableError();
      }
      if (closed === 'already_complete') {
        return summaryOf(found);
      }
    }
    const after = await this.#sequelize.transaction(async (transaction) => {
      const booking = await this.#repository.onlineBooking({ reference }, transaction);
      if (booking === undefined || booking.status !== 'pending_payment') {
        return booking;
      }
      await this.#repository.expireUnpaid(booking.id, transaction);
      await recordAudit(
        this.#sequelize,
        {
          actorType: 'customer',
          action: 'reservation.payment_abandoned',
          entityType: 'reservation',
          entityId: booking.id,
          changes: { status: { from: 'pending_payment', to: 'expired' } },
          ipAddress: origin.ip,
        },
        transaction,
      );
      return { ...booking, status: 'expired' as const };
    });
    return summaryOf(after ?? found);
  }

  /** Online rules (RM-06) and addresses back to the site: before anything is written. */
  async #check(request: OnlineBookingRequest): Promise<void> {
    const settings = await this.#catalog.findHotelSettings();
    if (settings === undefined) {
      throw new HotelNotConfiguredError();
    }
    const errors = onlineStayErrors(request.checkIn, request.checkOut, hotelClock(this.#now()), {
      maxStayNights: settings.onlineMaxStayNights,
      bookingHorizonDays: settings.onlineBookingHorizonDays,
      sameDayCutoffMinutes: minutesAfterMidnight(settings.sameDayCutoffTime),
    });
    for (const field of ['successUrl', 'cancelUrl'] as const) {
      if (!isSiteAddress(request[field], this.#siteUrl)) {
        errors.push({ field, message: 'Adresse de retour hors du site public.' });
      }
    }
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
  }

  /** The reservation, waiting for its payment, with its rooms held. */
  async #hold(
    request: OnlineBookingRequest,
    categoryId: string,
    idempotencyKey: string,
    requestHash: string,
    origin: ActionOrigin,
    hold: { paymentExpiresAt: Date },
  ): Promise<BookedReservation> {
    try {
      return await this.#sequelize.transaction(async (transaction) => {
        await this.#repository.claimIdempotencyKey(
          idempotencyKey,
          IDEMPOTENCY_SCOPE,
          requestHash,
          transaction,
        );
        const { customer } = request;
        const booked = await this.#reservations.book(
          { kind: 'website' },
          {
            checkIn: request.checkIn,
            checkOut: request.checkOut,
            ratePlan: request.ratePlan,
            source: 'website',
            rooms: request.rooms.map((room) => ({ ...room, categoryId, babyCot: false })),
            services: [],
            customer: {
              firstName: customer.firstName,
              lastName: customer.lastName,
              email: customer.email,
              phone: customer.phone,
              preferredLanguage: request.language,
              countryCode: customer.countryCode,
            },
            customerMessage: request.message,
            internalNotes: null,
          },
          origin,
          transaction,
          hold,
        );
        // The box « conditions of sale and cancellation » ticked: when, and in which language.
        await recordAudit(
          this.#sequelize,
          {
            actorType: 'system',
            action: 'reservation.terms_accepted',
            entityType: 'reservation',
            entityId: booked.id,
            changes: { acceptedAt: this.#now().toISOString(), language: request.language },
            ipAddress: origin.ip,
          },
          transaction,
        );
        return booked;
      });
    } catch (error) {
      if (error instanceof ConflictError && GONE_CODES.has(error.code)) {
        throw noLongerAvailable();
      }
      if (postgresCode(error) === UNIQUE_VIOLATION) {
        // The same key at the same moment: the first request is still opening its page.
        throw new ConflictError(
          'BOOKING_IN_PROGRESS',
          'Réservation en cours',
          'Votre réservation est déjà en cours de traitement : patientez quelques secondes.',
        );
      }
      throw error;
    }
  }

  /** Stripe failed: the rooms are given back and the key can be used again. */
  async #giveBack(reservationId: string, idempotencyKey: string): Promise<void> {
    await this.#sequelize.transaction(async (transaction) => {
      await this.#repository.expireUnpaid(reservationId, transaction);
      await this.#repository.forgetIdempotencyKey(idempotencyKey, transaction);
    });
  }

  /** The answer already given to this key, if any. */
  async #replay(key: string, requestHash: string): Promise<OnlineBookingAnswer | undefined> {
    const stored = await this.#repository.findIdempotencyKey(key);
    if (stored === undefined) {
      return undefined;
    }
    if (stored.requestHash !== requestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'Requête déjà utilisée',
        'Cette demande a déjà servi pour une autre réservation : rechargez la page.',
      );
    }
    if (stored.status === null) {
      throw new ConflictError(
        'BOOKING_IN_PROGRESS',
        'Réservation en cours',
        'Votre réservation est déjà en cours de traitement : patientez quelques secondes.',
      );
    }
    return stored.body as OnlineBookingAnswer;
  }
}
