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
import {
  addedNights,
  CANCELLABLE_STATUSES,
  cancellationFeeCents,
  isNightOf,
  ROOM_CHANGE_STATUSES,
  STAY_CHANGE_STATUSES,
} from '../domain/change-rules.ts';
import { countedGuests, fitsIn, nightsOf, quoteRoom } from '../domain/quote.ts';
import { freeCancellationUntil, nightLabel, serviceQuantity } from '../domain/reservation-rules.ts';
import { stayDateErrors } from '../domain/stay-rules.ts';
import { AvailabilityRepository } from '../infrastructure/availability-repository.ts';
import {
  type ChargeState,
  type FreeRoom,
  type LineState,
  type LockedReservation,
  type NewReservationRoom,
  type ReservationDetail,
  ReservationRepository,
} from '../infrastructure/reservation-repository.ts';
import type { ActionOrigin } from './reservation-service.ts';

/** New guests of one booked room. */
export interface LineChange {
  lineId: string;
  adults: number;
  childrenAges: number[];
  babyCot: boolean;
}

/** What a PATCH may change; a field left out keeps its value. */
export interface ChangeRequest {
  checkIn?: string | undefined;
  checkOut?: string | undefined;
  rooms?: LineChange[] | undefined;
  internalNotes?: string | null | undefined;
  customerMessage?: string | null | undefined;
  /** Required for a non-refundable reservation (RM-18): written in the audit log. */
  reason?: string | undefined;
}

/** The new price of the stay, before it is saved (UI/UX specification: « difference »). */
export interface ChangePreview {
  checkIn: string;
  checkOut: string;
  previousTotalCents: number;
  totalCents: number;
  differenceCents: number;
  rooms: { lineId: string; subtotalCents: number; nights: NewReservationRoom['nights'] }[];
  charges: { kind: string; quantity: number; totalCents: number }[];
}

export interface CancellationQuote {
  feeCents: number;
  freeCancellationUntil: Date | null;
  /** Only the management may cancel a non-refundable reservation or waive the fee. */
  managementOnly: boolean;
}

const EXCLUSION_VIOLATION = '23P01';

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const parent = (error as { parent?: { code?: unknown } }).parent;
  return typeof parent?.code === 'string' ? parent.code : undefined;
}

const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

export class VersionRequiredError extends AppError {
  constructor() {
    super({
      status: 428,
      code: 'VERSION_REQUIRED',
      title: 'Version manquante',
      detail: 'En-tête If-Match obligatoire : la version de la réservation lue.',
    });
  }
}

export class ReservationChangedError extends AppError {
  constructor(by: string) {
    super({
      status: 412,
      code: 'RESERVATION_CHANGED',
      title: 'Réservation modifiée entre-temps',
      detail: `Cette réservation a été modifiée ${by}. Rechargez-la avant de recommencer.`,
    });
  }
}

export class ManagementOnlyError extends AppError {
  constructor(detail: string) {
    super({ status: 403, code: 'MANAGEMENT_ONLY', title: 'Réservé à la direction', detail });
  }
}

/** `room`: « 214 », or « attribuée » when the database refused without saying which. */
function roomNotFree(room: string): ConflictError {
  return new ConflictError(
    'ROOM_NOT_FREE',
    'Chambre indisponible',
    `La chambre ${room} n’est pas libre sur ces dates : changez de chambre d’abord.`,
  );
}

function wrongState(detail: string): ConflictError {
  return new ConflictError('RESERVATION_STATE', 'Action impossible', detail);
}

/**
 * Changes of a reservation by the staff: dates, guests and notes (with a preview of the new
 * price), cancellation with its fee, room given or changed. Each change runs in one
 * transaction which locks the reservation first, then writes the audit log.
 */
export class ReservationChanges {
  readonly #sequelize: Sequelize;
  readonly #repository: ReservationRepository;
  readonly #availability: AvailabilityRepository;
  readonly #catalog: CatalogRepository;
  readonly #today: () => string;
  readonly #now: () => Date;

  /** `today` (« YYYY-MM-DD » at the hotel) and `now` come from the clock; the tests fix them. */
  constructor(sequelize: Sequelize, today: () => string, now: () => Date) {
    this.#sequelize = sequelize;
    this.#repository = new ReservationRepository(sequelize);
    this.#availability = new AvailabilityRepository(sequelize);
    this.#catalog = new CatalogRepository(sequelize);
    this.#today = today;
    this.#now = now;
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

  async #locked(id: string, transaction: Transaction): Promise<LockedReservation> {
    const reservation = await this.#repository.lockReservation(id, transaction);
    if (reservation === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    return reservation;
  }

  async #detail(id: string, transaction?: Transaction): Promise<ReservationDetail> {
    const detail = await this.#repository.detail(id, transaction);
    if (detail === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    return detail;
  }

  /** « par Sophie Martin à 10:42 », from the audit log. */
  async #changedError(id: string, transaction: Transaction): Promise<ReservationChangedError> {
    const last = await this.#repository.lastChange(id, transaction);
    if (last === undefined) {
      return new ReservationChangedError('par un collègue');
    }
    const who = last.actor === null ? 'automatiquement' : `par ${last.actor}`;
    return new ReservationChangedError(`${who} à ${TIME_FORMAT.format(last.at)}`);
  }

  // --- Dates, guests and notes ---

  async modify(
    actor: StaffUser,
    id: string,
    version: number,
    changes: ChangeRequest,
    preview: boolean,
    origin: ActionOrigin,
  ): Promise<ReservationDetail | ChangePreview> {
    try {
      return await this.#sequelize.transaction(async (transaction) => {
        const current = await this.#locked(id, transaction);
        if (current.version !== version) {
          throw await this.#changedError(id, transaction);
        }
        return await this.#modifyLocked(actor, current, changes, preview, origin, transaction);
      });
    } catch (error) {
      // Another booking took the assigned room meanwhile: the database refused (RM-03).
      if (postgresCode(error) === EXCLUSION_VIOLATION) {
        throw roomNotFree('attribuée');
      }
      throw error;
    }
  }

  async #modifyLocked(
    actor: StaffUser,
    current: LockedReservation,
    changes: ChangeRequest,
    preview: boolean,
    origin: ActionOrigin,
    transaction: Transaction,
  ): Promise<ReservationDetail | ChangePreview> {
    const { id } = current;
    const detail = await this.#detail(id, transaction);
    const next = {
      checkIn: changes.checkIn ?? current.checkIn,
      checkOut: changes.checkOut ?? current.checkOut,
    };
    const datesChange = next.checkIn !== current.checkIn || next.checkOut !== current.checkOut;
    const stayChange = datesChange || (changes.rooms?.length ?? 0) > 0;
    const notesChange =
      changes.internalNotes !== undefined || changes.customerMessage !== undefined;
    if (!stayChange && !notesChange) {
      throw new ValidationError([{ field: 'body', message: 'Rien à modifier.' }]);
    }
    if (stayChange) {
      this.#checkStayChange(actor, current, changes, next);
    }

    const lines = await this.#repository.lines(id, transaction);
    const plan = stayChange
      ? await this.#planStay(current, lines, changes.rooms ?? [], next, transaction)
      : undefined;
    const totalCents = plan?.totalCents ?? detail.totalCents;
    if (preview) {
      return {
        ...next,
        previousTotalCents: detail.totalCents,
        totalCents,
        differenceCents: totalCents - detail.totalCents,
        rooms: plan?.rooms ?? [],
        charges: plan?.charges ?? [],
      };
    }

    await this.#repository.updateStay(
      id,
      {
        ...next,
        totalCents,
        freeCancellationUntil:
          plan === undefined ? current.freeCancellationUntil : plan.freeCancellationUntil,
        // undefined: unchanged; null: emptied.
        internalNotes:
          changes.internalNotes === undefined ? detail.internalNotes : changes.internalNotes,
        customerMessage:
          changes.customerMessage === undefined ? detail.customerMessage : changes.customerMessage,
      },
      transaction,
    );
    if (plan !== undefined) {
      await this.#writeStay(id, plan, actor, transaction);
    }
    const audit: Record<string, unknown> = {};
    if (datesChange) {
      audit['dates'] = {
        from: [current.checkIn, current.checkOut],
        to: [next.checkIn, next.checkOut],
      };
    }
    if (changes.rooms !== undefined) {
      audit['rooms'] = changes.rooms;
    }
    if (notesChange) {
      audit['notes'] = true;
    }
    if (totalCents !== detail.totalCents) {
      audit['totalCents'] = { from: detail.totalCents, to: totalCents };
    }
    if (changes.reason !== undefined) {
      audit['reason'] = changes.reason;
    }
    await this.#audit(actor, 'reservation.updated', id, audit, origin, transaction);
    return this.#detail(id, transaction);
  }

  /** State, rights (RM-18) and dates (RM-04) of a change of dates or guests. */
  #checkStayChange(
    actor: StaffUser,
    current: LockedReservation,
    changes: ChangeRequest,
    next: { checkIn: string; checkOut: string },
  ): void {
    if (!STAY_CHANGE_STATUSES.includes(current.status)) {
      throw wrongState('Seule une réservation confirmée change de dates ou de voyageurs.');
    }
    if (current.ratePlan === 'non_refundable') {
      if (actor.role !== 'direction') {
        throw new ManagementOnlyError(
          'Tarif non remboursable : seule la direction peut modifier ce séjour, avec un motif.',
        );
      }
      if (changes.reason === undefined) {
        throw new ValidationError([
          { field: 'reason', message: 'Motif obligatoire pour un tarif non remboursable.' },
        ]);
      }
    }
    // An arrival already past may stay as it is; a new arrival may not be in the past.
    const errors = stayDateErrors(next.checkIn, next.checkOut, this.#today()).filter(
      (error) => error.field !== 'checkIn' || next.checkIn !== current.checkIn,
    );
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
  }

  /**
   * The new stay, priced at today's rates (decision of the module plan): rooms checked for
   * capacity, nights added checked for closures, rooms counted without this reservation's own,
   * the rooms already given checked free and in service on the new nights.
   */
  async #planStay(
    current: LockedReservation,
    lines: LineState[],
    lineChanges: LineChange[],
    next: { checkIn: string; checkOut: string },
    transaction: Transaction,
  ): Promise<StayPlan> {
    const settings = await this.#repository.bookingSettings(transaction);
    if (settings === undefined) {
      throw new HotelNotConfiguredError();
    }
    const problems: FieldError[] = [];
    lineChanges.forEach((change, index) => {
      if (!lines.some((line) => line.id === change.lineId)) {
        problems.push({ field: `rooms[${index}].lineId`, message: 'Chambre inconnue.' });
      }
    });
    const updated = lines.map((line) => {
      const change = lineChanges.find((item) => item.lineId === line.id);
      return change === undefined ? line : { ...line, ...change };
    });

    const categoryIds = [...new Set(updated.map((line) => line.categoryId))];
    const locked = await this.#repository.lockCategories(categoryIds, transaction);
    const categories = new Map(locked.map((category) => [category.id, category]));
    updated.forEach((line) => {
      const category = categories.get(line.categoryId);
      if (category !== undefined && !fitsIn(category, line)) {
        const index = lineChanges.findIndex((change) => change.lineId === line.id);
        const message = `${category.maxOccupancy} personne(s) au plus dans cette catégorie.`;
        problems.push({ field: index < 0 ? 'rooms' : `rooms[${index}]`, message });
      }
    });
    if (problems.length > 0) {
      throw new ValidationError(problems);
    }

    for (const range of addedNights(current, next)) {
      const closed = await this.#availability.closedCategoryIds(range.from, range.to, transaction);
      const name = locked.find((category) => closed.has(category.id))?.name;
      if (name !== undefined) {
        throw new ConflictError(
          'CATEGORY_CLOSED',
          'Catégorie fermée à la vente',
          `« ${name} » est fermée à la vente sur les nouvelles nuits : rouvrez la vente d’abord.`,
        );
      }
    }
    const { checkIn, checkOut } = next;
    const free = await this.#availability.freeRoomsByNight(checkIn, checkOut, transaction);
    for (const categoryId of categoryIds) {
      const wanted = updated.filter((line) => line.categoryId === categoryId).length;
      const short = free.find((row) => {
        // This reservation's own rooms are counted as booked on its present nights.
        const own = isNightOf(row.night, current) ? wanted : 0;
        return row.categoryId === categoryId && row.free + own < wanted;
      });
      if (short !== undefined) {
        throw new ConflictError(
          'NOT_AVAILABLE',
          'Plus assez de chambres',
          `Plus assez de chambres « ${categories.get(categoryId)?.name ?? ''} » ` +
            `la nuit du ${short.night} pour ces dates.`,
        );
      }
    }
    if (next.checkIn !== current.checkIn || next.checkOut !== current.checkOut) {
      for (const line of updated) {
        if (line.roomId === null) {
          continue;
        }
        const blocked = await this.#repository.roomBlockedDuring(
          line.roomId,
          next.checkIn,
          next.checkOut,
          transaction,
        );
        const taken = await this.#repository.roomTakenDuring(
          line.roomId,
          next.checkIn,
          next.checkOut,
          current.id,
          transaction,
        );
        if (blocked || taken !== undefined) {
          throw roomNotFree(line.roomNumber ?? '');
        }
      }
    }

    const periods = await this.#catalog.listRatePeriods(next.checkIn, next.checkOut);
    const rooms = updated.map((line) => {
      const category = categories.get(line.categoryId);
      if (category === undefined) {
        throw new Error('catégorie verrouillée plus haut');
      }
      const quote = quoteRoom({ category, periods, ...next, occupancy: line, settings });
      const flexible = current.ratePlan === 'flexible';
      const nights = quote.nights.map((night) => ({
        night: night.night,
        priceCents: flexible ? night.flexibleCents : night.nonRefundableCents,
        rateLabel: nightLabel(night.adjustmentPct),
      }));
      return {
        lineId: line.id,
        adults: line.adults,
        childrenAges: line.childrenAges,
        babyCot: line.babyCot,
        subtotalCents: nights.reduce((sum, night) => sum + night.priceCents, 0),
        nights,
      };
    });

    const charges = await this.#repository.charges(current.id, transaction);
    const nightCount = nightsOf(next.checkIn, next.checkOut).length;
    const guests = updated.reduce((sum, line) => sum + countedGuests(line), 0);
    const adults = updated.reduce((sum, line) => sum + line.adults, 0);
    const recounted = charges
      .filter((charge) => charge.kind !== 'tourist_tax' || charge.invoiced)
      .map((charge) => recount(charge, guests, nightCount));
    const touristTax =
      settings.touristTaxCentsPerAdultNight > 0
        ? {
            quantity: adults * nightCount,
            unitPriceCents: settings.touristTaxCentsPerAdultNight,
            totalCents: adults * nightCount * settings.touristTaxCentsPerAdultNight,
          }
        : undefined;
    const totalCents =
      rooms.reduce((sum, room) => sum + room.subtotalCents, 0) +
      recounted.reduce((sum, charge) => sum + charge.totalCents, 0) +
      (touristTax?.totalCents ?? 0);

    return {
      rooms,
      recounted,
      oldTouristTax: charges.filter((charge) => charge.kind === 'tourist_tax' && !charge.invoiced),
      touristTax,
      totalCents,
      freeCancellationUntil: freeCancellationUntil({
        ratePlan: current.ratePlan,
        checkIn: next.checkIn,
        checkInTime: settings.checkInTime,
        freeCancellationHours: settings.freeCancellationHours,
      }),
      charges: [
        ...recounted.map(({ kind, quantity, totalCents: total }) => ({
          kind,
          quantity,
          totalCents: total,
        })),
        ...(touristTax === undefined ? [] : [{ kind: 'tourist_tax', ...touristTax }]),
      ],
    };
  }

  async #writeStay(
    id: string,
    plan: StayPlan,
    actor: StaffUser,
    transaction: Transaction,
  ): Promise<void> {
    for (const room of plan.rooms) {
      await this.#repository.rewriteLine(room.lineId, room, transaction);
    }
    for (const charge of plan.recounted) {
      if (charge.changed) {
        await this.#repository.recountCharge(
          charge.id,
          charge.quantity,
          charge.totalCents,
          transaction,
        );
      }
    }
    for (const charge of plan.oldTouristTax) {
      await this.#repository.deleteCharge(charge.id, transaction);
    }
    if (plan.touristTax !== undefined) {
      await this.#repository.insertCharge(
        id,
        {
          kind: 'tourist_tax',
          serviceId: null,
          label: 'Taxe de séjour',
          quantity: plan.touristTax.quantity,
          unitPriceCents: plan.touristTax.unitPriceCents,
          vatRate: 0,
          totalCents: plan.touristTax.totalCents,
        },
        actor.id,
        transaction,
      );
    }
  }

  // --- Cancellation ---

  /** The fee a cancellation would cost now, for the confirmation window. */
  async cancellationQuote(id: string): Promise<CancellationQuote> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#locked(id, transaction);
      const totals = await this.#repository.nightTotals(id, transaction);
      return {
        feeCents: cancellationFeeCents({
          ratePlan: current.ratePlan,
          now: this.#now(),
          freeCancellationUntil: current.freeCancellationUntil,
          ...totals,
        }),
        freeCancellationUntil: current.freeCancellationUntil,
        managementOnly: current.ratePlan === 'non_refundable',
      };
    });
  }

  async cancel(
    actor: StaffUser,
    id: string,
    request: { reason: string; waiveFee: boolean },
    origin: ActionOrigin,
  ): Promise<ReservationDetail> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#locked(id, transaction);
      if (!CANCELLABLE_STATUSES.includes(current.status)) {
        throw wrongState('Seule une réservation pas encore arrivée peut être annulée.');
      }
      if (actor.role !== 'direction') {
        if (current.ratePlan === 'non_refundable') {
          throw new ManagementOnlyError(
            'Tarif non remboursable : seule la direction peut annuler cette réservation.',
          );
        }
        if (request.waiveFee) {
          throw new ManagementOnlyError('Seule la direction peut renoncer aux frais d’annulation.');
        }
      }
      const totals = await this.#repository.nightTotals(id, transaction);
      const dueCents = cancellationFeeCents({
        ratePlan: current.ratePlan,
        now: this.#now(),
        freeCancellationUntil: current.freeCancellationUntil,
        ...totals,
      });
      const feeCents = request.waiveFee ? 0 : dueCents;
      await this.#repository.cancel(id, request.reason, feeCents, transaction);
      await this.#audit(
        actor,
        'reservation.cancelled',
        id,
        { reason: request.reason, feeCents, waivedCents: request.waiveFee ? dueCents : 0 },
        origin,
        transaction,
      );
      return this.#detail(id, transaction);
    });
  }

  // --- Room given to a booked room ---

  async #line(reservationId: string, lineId: string, transaction: Transaction): Promise<LineState> {
    const line = (await this.#repository.lines(reservationId, transaction)).find(
      (item) => item.id === lineId,
    );
    if (line === undefined) {
      throw new NotFoundError('Cette chambre ne fait pas partie de la réservation.');
    }
    return line;
  }

  /** Rooms the selector offers: same category, free and in service on every night. */
  async freeRoomsFor(reservationId: string, lineId: string): Promise<FreeRoom[]> {
    return this.#sequelize.transaction(async (transaction) => {
      const current = await this.#locked(reservationId, transaction);
      const line = await this.#line(reservationId, lineId, transaction);
      const { checkIn, checkOut } = current;
      return this.#repository.freeRooms(line.categoryId, checkIn, checkOut, line.id);
    });
  }

  /**
   * Gives a room to a booked room, or takes it back (`roomId` null). Refused: another category
   * (decision of the module plan), a deactivated room (probe P3), a room out of service on one
   * night (probe P4), a room already given (also refused by the database itself, RM-03).
   */
  async assignRoom(
    actor: StaffUser,
    reservationId: string,
    lineId: string,
    roomId: string | null,
    origin: ActionOrigin,
  ): Promise<ReservationDetail> {
    try {
      return await this.#sequelize.transaction(async (transaction) => {
        const current = await this.#locked(reservationId, transaction);
        if (!ROOM_CHANGE_STATUSES.includes(current.status)) {
          throw wrongState('Cette réservation n’attend plus de chambre.');
        }
        const line = await this.#line(reservationId, lineId, transaction);
        if (roomId !== null) {
          await this.#checkRoom(current, line, roomId, transaction);
        }
        await this.#repository.setRoom(reservationId, lineId, roomId, transaction);
        await this.#audit(
          actor,
          'reservation.room_assigned',
          reservationId,
          { lineId, roomId: { from: line.roomId, to: roomId } },
          origin,
          transaction,
        );
        return this.#detail(reservationId, transaction);
      });
    } catch (error) {
      if (postgresCode(error) === EXCLUSION_VIOLATION) {
        throw new ConflictError(
          'ROOM_ALREADY_ASSIGNED',
          'Chambre déjà attribuée',
          'Un autre séjour occupe déjà cette chambre sur ces nuits.',
        );
      }
      throw error;
    }
  }

  async #checkRoom(
    current: LockedReservation,
    line: LineState,
    roomId: string,
    transaction: Transaction,
  ): Promise<void> {
    const room = await this.#repository.roomForAssignment(roomId, transaction);
    if (room === undefined || room.categoryId !== line.categoryId) {
      throw new ValidationError([
        { field: 'roomId', message: 'Choisissez une chambre de la catégorie réservée.' },
      ]);
    }
    if (!room.isActive) {
      throw new ConflictError(
        'ROOM_INACTIVE',
        'Chambre désactivée',
        `La chambre ${room.number} est désactivée : elle ne peut pas être attribuée.`,
      );
    }
    const { checkIn, checkOut } = current;
    if (await this.#repository.roomBlockedDuring(roomId, checkIn, checkOut, transaction)) {
      throw new ConflictError(
        'ROOM_OUT_OF_SERVICE',
        'Chambre hors service',
        `La chambre ${room.number} est hors service sur une partie du séjour.`,
      );
    }
    const taken = await this.#repository.roomTakenDuring(
      roomId,
      checkIn,
      checkOut,
      current.id,
      transaction,
    );
    if (taken !== undefined) {
      throw new ConflictError(
        'ROOM_ALREADY_ASSIGNED',
        'Chambre déjà attribuée',
        `La chambre ${room.number} est déjà attribuée à la réservation ${taken} sur ces nuits.`,
      );
    }
  }
}

interface RecountedCharge {
  id: string;
  kind: string;
  quantity: number;
  totalCents: number;
  changed: boolean;
}

interface StayPlan {
  rooms: (Omit<NewReservationRoom, 'categoryId'> & { lineId: string })[];
  recounted: RecountedCharge[];
  oldTouristTax: ChargeState[];
  touristTax: { quantity: number; unitPriceCents: number; totalCents: number } | undefined;
  totalCents: number;
  freeCancellationUntil: Date | null;
  charges: ChangePreview['charges'];
}

/** A service counted per guest or per night follows the new stay; its unit price stays frozen. */
function recount(charge: ChargeState, guests: number, nights: number): RecountedCharge {
  const counted =
    !charge.invoiced &&
    (charge.pricingUnit === 'per_person_night' || charge.pricingUnit === 'per_night');
  const quantity =
    counted && charge.pricingUnit !== null
      ? serviceQuantity(charge.pricingUnit, { guests, nights, units: charge.quantity })
      : charge.quantity;
  const changed = quantity !== charge.quantity;
  return {
    id: charge.id,
    kind: charge.kind,
    quantity,
    totalCents: changed ? Math.round(quantity * charge.unitPriceCents) : charge.totalCents,
    changed,
  };
}
