import type { Sequelize, Transaction } from 'sequelize';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import {
  checkInProblem,
  checkOutProblem,
  noShowFeeCents,
  noShowProblem,
} from '../domain/front-desk-rules.ts';
import {
  FrontDeskRepository,
  type FrontDeskRoom,
  type FrontDeskStay,
} from '../infrastructure/front-desk-repository.ts';
import {
  type LockedReservation,
  type ReservationDetail,
  ReservationRepository,
} from '../infrastructure/reservation-repository.ts';
import { ReservationChangedError } from './reservation-changes.ts';
import type { ActionOrigin } from './reservation-service.ts';

/** One stay of the arrivals or departures list. */
export interface FrontDeskItem {
  id: string;
  reference: string;
  status: FrontDeskStay['status'];
  version: number;
  ratePlan: FrontDeskStay['ratePlan'];
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  customerName: string;
  adults: number;
  children: number;
  customerMessage: string | null;
  rooms: FrontDeskRoom[];
  /** Expected before the day shown (late arrival, or departure forgotten). */
  late: boolean;
}

export interface FrontDeskDay {
  date: string;
  arrivals: { total: number; done: number; items: FrontDeskItem[] };
  departures: { total: number; done: number; items: FrontDeskItem[] };
}

/** What the reception ticked at the arrival (not blocking), and the dirty room accepted. */
export interface CheckInRequest {
  identityChecked: boolean;
  policeFormDone: boolean;
  /** The room is to be cleaned and the reception gives it all the same. */
  acceptDirtyRoom: boolean;
}

const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

function wrongState(detail: string): ConflictError {
  return new ConflictError('RESERVATION_STATE', 'Action impossible', detail);
}

function itemOf(stay: FrontDeskStay, late: boolean): FrontDeskItem {
  const { firstName, lastName, ...rest } = stay;
  return { ...rest, customerName: `${lastName} ${firstName}`, late };
}

/**
 * The front desk (UI/UX specification, section 5.H): the arrivals and departures of a day, and
 * the arrival, the departure and the no-show of a stay. Each action locks the reservation,
 * checks the version read by the screen (If-Match), then writes the audit log.
 */
export class FrontDesk {
  readonly #sequelize: Sequelize;
  readonly #repository: FrontDeskRepository;
  readonly #reservations: ReservationRepository;
  readonly #today: () => string;

  /** `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. */
  constructor(sequelize: Sequelize, today: () => string) {
    this.#sequelize = sequelize;
    this.#repository = new FrontDeskRepository(sequelize);
    this.#reservations = new ReservationRepository(sequelize);
    this.#today = today;
  }

  async day(date: string): Promise<FrontDeskDay> {
    const arrivals = (await this.#repository.arrivals(date)).map((stay) => {
      return itemOf(stay, stay.checkIn < date);
    });
    const departures = (await this.#repository.departures(date)).map((stay) => {
      return itemOf(stay, stay.checkOut < date);
    });
    // The counters cover the stays of the day; the late ones are listed but not counted.
    const arrivedToday = arrivals.filter((item) => item.checkIn === date);
    const leftToday = departures.filter((item) => item.checkOut === date);
    return {
      date,
      arrivals: {
        total: arrivedToday.length,
        done: arrivedToday.filter((item) => item.status !== 'confirmed').length,
        items: arrivals,
      },
      departures: {
        total: leftToday.length,
        done: leftToday.filter((item) => item.status === 'checked_out').length,
        items: departures,
      },
    };
  }

  async #audit(
    actor: StaffUser,
    action: string,
    reservationId: string,
    changes: Record<string, unknown>,
    origin: ActionOrigin,
    transaction: Transaction,
  ): Promise<void> {
    await recordAudit(
      this.#sequelize,
      {
        actorType: 'staff',
        actorUserId: actor.id,
        action,
        entityType: 'reservation',
        entityId: reservationId,
        changes,
        ipAddress: origin.ip,
      },
      transaction,
    );
  }

  /** The reservation, locked, at the version the screen read; otherwise 404 or 412. */
  async #locked(id: string, version: number, transaction: Transaction): Promise<LockedReservation> {
    const current = await this.#reservations.lockReservation(id, transaction);
    if (current === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    if (current.version !== version) {
      const last = await this.#reservations.lastChange(id, transaction);
      if (last === undefined) {
        throw new ReservationChangedError('par un collègue');
      }
      const who = last.actor === null ? 'automatiquement' : `par ${last.actor}`;
      throw new ReservationChangedError(`${who} à ${TIME_FORMAT.format(last.at)}`);
    }
    return current;
  }

  async #detail(id: string, transaction: Transaction): Promise<ReservationDetail> {
    const detail = await this.#reservations.detail(id, transaction);
    if (detail === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    return detail;
  }

  /**
   * Arrival: every booked room given and in service until the departure (blocking); a room to
   * be cleaned only with `acceptDirtyRoom` (written in the audit log).
   */
  async checkIn(
    actor: StaffUser,
    id: string,
    version: number,
    request: CheckInRequest,
    origin: ActionOrigin,
  ): Promise<ReservationDetail> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#locked(id, version, transaction);
      const today = this.#today();
      const problem = checkInProblem(current, today);
      if (problem !== null) {
        throw wrongState(problem);
      }
      const rooms = await this.#repository.arrivalRooms(id, today, current.checkOut, transaction);
      if (rooms.some((room) => room.roomId === null)) {
        throw new ConflictError(
          'ROOM_NOT_ASSIGNED',
          'Chambre à attribuer',
          'Attribuez une chambre à chaque ligne de la réservation avant l’arrivée.',
        );
      }
      const blocked = rooms.find((room) => room.outOfService);
      if (blocked !== undefined) {
        throw new ConflictError(
          'ROOM_OUT_OF_SERVICE',
          'Chambre hors service',
          `La chambre ${blocked.number ?? ''} est hors service : choisissez-en une autre.`,
        );
      }
      const dirty = rooms.filter((room) => room.housekeepingStatus === 'dirty');
      const dirtyNumbers = dirty.map((room) => room.number ?? '');
      if (dirty.length > 0 && !request.acceptDirtyRoom) {
        const which =
          dirty.length === 1
            ? `La chambre ${dirtyNumbers.join('')} est à nettoyer`
            : `Les chambres ${dirtyNumbers.join(', ')} sont à nettoyer`;
        throw new ConflictError(
          'ROOM_DIRTY',
          'Chambre à nettoyer',
          `${which} : choisissez-en une autre, ou confirmez l’arrivée quand même.`,
        );
      }
      await this.#repository.setStatus(id, 'checked_in', transaction);
      await this.#audit(
        actor,
        'reservation.checked_in',
        id,
        {
          identityChecked: request.identityChecked,
          policeFormDone: request.policeFormDone,
          ...(dirty.length > 0 ? { dirtyRoomsAccepted: dirtyNumbers } : {}),
        },
        origin,
        transaction,
      );
      return this.#detail(id, transaction);
    });
  }

  /** Departure: the stay is over, its rooms are to be cleaned. The balance is not settled yet. */
  async checkOut(
    actor: StaffUser,
    id: string,
    version: number,
    origin: ActionOrigin,
  ): Promise<ReservationDetail> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#locked(id, version, transaction);
      const problem = checkOutProblem(current, this.#today());
      if (problem !== null) {
        throw wrongState(problem);
      }
      await this.#repository.setStatus(id, 'checked_out', transaction);
      const rooms = await this.#repository.roomsToClean(id, transaction);
      await this.#audit(actor, 'reservation.checked_out', id, { rooms }, origin, transaction);
      return this.#detail(id, transaction);
    });
  }

  /** No-show (RM-17): the rooms are released and the fee is kept « to collect ». */
  async noShow(
    actor: StaffUser,
    id: string,
    version: number,
    origin: ActionOrigin,
  ): Promise<ReservationDetail> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#locked(id, version, transaction);
      const problem = noShowProblem(current, this.#today());
      if (problem !== null) {
        throw wrongState(problem);
      }
      const nights = await this.#reservations.nightTotals(id, transaction);
      const feeCents = noShowFeeCents(current.ratePlan, nights);
      await this.#repository.setNoShow(id, feeCents, transaction);
      await this.#audit(actor, 'reservation.no_show', id, { feeCents }, origin, transaction);
      return this.#detail(id, transaction);
    });
  }
}
