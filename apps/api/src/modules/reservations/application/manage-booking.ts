import type { Sequelize, Transaction } from 'sequelize';
import { AppError, ConflictError } from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import {
  CUSTOMER_CANCELLATION_REASON,
  manageTokenHash,
  type OnlineCancellation,
  onlineCancellation,
} from '../domain/manage-booking-rules.ts';
import { ManageBookingRepository } from '../infrastructure/manage-booking-repository.ts';
import { ReservationRepository } from '../infrastructure/reservation-repository.ts';
import { type OnlineBookingSummary, summaryOf } from './online-booking.ts';

/** The booking as the page « Gérer ma réservation » shows it: no card data. */
export interface ManagedBooking extends OnlineBookingSummary {
  firstName: string;
  /** Flexible rate: until when it can be cancelled at no cost (ISO instant). */
  freeCancellationUntil: string | null;
  /** What the customer may do himself (see onlineCancellation). */
  cancellation: OnlineCancellation;
}

/**
 * A wrong reference, a wrong token, a link expired or replaced: always this same answer, so
 * that nothing can be learnt by trying.
 */
export class ManageLinkInvalidError extends AppError {
  constructor() {
    super({
      status: 404,
      code: 'MANAGE_LINK_INVALID',
      title: 'Lien non valide',
      detail:
        'Ce lien n’est pas ou plus valide. Demandez un nouveau lien avec votre référence et ' +
        'votre e-mail, ou appelez la réception.',
    });
  }
}

export interface ManageAccess {
  reference: string;
  token: string;
}

/**
 * « Gérer ma réservation » (step M): the customer reads his booking of the website with his
 * secret link, and cancels it himself when the flexible rate allows it at no cost (decision
 * « 2a »). Otherwise the page tells him the conditions and the telephone of the reception.
 */
export class ManageBooking {
  readonly #sequelize: Sequelize;
  readonly #links: ManageBookingRepository;
  readonly #reservations: ReservationRepository;
  readonly #now: () => Date;

  constructor(options: { sequelize: Sequelize; now: () => Date }) {
    this.#sequelize = options.sequelize;
    this.#links = new ManageBookingRepository(options.sequelize);
    this.#reservations = new ReservationRepository(options.sequelize);
    this.#now = options.now;
  }

  async view(access: ManageAccess): Promise<ManagedBooking> {
    return this.#sequelize.transaction(async (transaction) => {
      return this.#managed(access, transaction);
    });
  }

  /**
   * Cancels at no cost: the rooms are given back at once, the card saved as a guarantee is not
   * charged. Asked twice (double click), the second answer is the booking already cancelled.
   */
  async cancel(access: ManageAccess): Promise<ManagedBooking> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#managed(access, transaction);
      if (current.status === 'cancelled') {
        return current;
      }
      if (current.cancellation !== 'free') {
        throw new ConflictError(
          'CANCELLATION_NOT_ONLINE',
          'Annulation impossible en ligne',
          'Cette réservation ne peut pas être annulée en ligne : appelez la réception.',
        );
      }
      const record = await this.#record(access, transaction);
      await this.#reservations.cancel(record.id, CUSTOMER_CANCELLATION_REASON, 0, transaction);
      await recordAudit(
        this.#sequelize,
        {
          actorType: 'system',
          action: 'reservation.cancelled_by_customer',
          entityType: 'reservation',
          entityId: record.id,
          changes: { status: { from: 'confirmed', to: 'cancelled' }, feeCents: 0 },
        },
        transaction,
      );
      return this.#managed(access, transaction);
    });
  }

  async #record(access: ManageAccess, transaction: Transaction) {
    const record = await this.#links.byToken(
      access.reference,
      manageTokenHash(access.token),
      this.#now(),
      transaction,
    );
    if (record === undefined) {
      throw new ManageLinkInvalidError();
    }
    return record;
  }

  async #managed(access: ManageAccess, transaction: Transaction): Promise<ManagedBooking> {
    const record = await this.#record(access, transaction);
    const booking = await this.#reservations.onlineBooking(
      { reference: access.reference },
      transaction,
    );
    if (booking === undefined) {
      throw new ManageLinkInvalidError();
    }
    return {
      ...summaryOf(booking),
      firstName: record.firstName,
      freeCancellationUntil: record.freeCancellationUntil?.toISOString() ?? null,
      cancellation: onlineCancellation({
        status: record.status,
        ratePlan: booking.ratePlan,
        freeCancellationUntil: record.freeCancellationUntil,
        now: this.#now(),
      }),
    };
  }
}
