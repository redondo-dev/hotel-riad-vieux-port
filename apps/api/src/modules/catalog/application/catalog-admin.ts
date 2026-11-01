import type { Sequelize, Transaction } from 'sequelize';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { MAX_PERIOD_NIGHTS } from '../domain/catalog-admin-rules.ts';
import { addDays } from '../domain/pricing.ts';
import {
  CatalogAdminRepository,
  type CategoryAdminView,
  type CategoryFields,
  type RatePeriodAdminView,
  type RatePeriodFields,
  type RoomAdminView,
  type RoomFields,
  type RoomFilter,
  type SalesClosureAdminView,
  type SalesClosureFields,
  type ServiceAdminView,
  type ServiceFields,
} from '../infrastructure/catalog-admin-repository.ts';

/**
 * Catalogue management by the staff. Each change runs in one transaction: the row is read and
 * locked, the new values are checked, the row is written, and the change is written to the
 * audit log (who, what, before → after). If any step fails, nothing is kept.
 *
 * A price change only affects FUTURE quotes: each reservation keeps the price of its nights.
 */

export interface ActionOrigin {
  ip: string | undefined;
}

/** Fields to change; a missing (or undefined) field keeps its current value. */
export type Changes<T> = { [K in keyof T]?: T[K] | undefined };

function merge<T extends object>(before: T, changes: Changes<T>): T {
  const after = { ...before };
  for (const key of Object.keys(changes) as (keyof T)[]) {
    const value = changes[key];
    if (value !== undefined) {
      after[key] = value;
    }
  }
  return after;
}

/** PostgreSQL error code carried by a Sequelize error, if any. */
function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const parent = (error as { parent?: { code?: unknown } }).parent;
  return typeof parent?.code === 'string' ? parent.code : undefined;
}

const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

/** « before → after » of each field that changed; nested texts are compared as JSON. */
function differences<T extends object>(before: T, after: T): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key] = { from: before[key], to: after[key] };
    }
  }
  return changed;
}

/** « x.deactivated » or « x.reactivated » when the state changes, « x.updated » otherwise. */
function updateAction(entity: string, wasActive: boolean, isActive: boolean): string {
  if (wasActive && !isActive) {
    return `${entity}.deactivated`;
  }
  if (!wasActive && isActive) {
    return `${entity}.reactivated`;
  }
  return `${entity}.updated`;
}

function checkNights(firstNight: string, lastNight: string): void {
  if (lastNight < firstNight) {
    throw new ValidationError([
      { field: 'lastNight', message: 'La dernière nuit doit suivre ou égaler la première.' },
    ]);
  }
  if (addDays(firstNight, MAX_PERIOD_NIGHTS) <= lastNight) {
    throw new ValidationError([
      { field: 'lastNight', message: `Une période dure au plus ${MAX_PERIOD_NIGHTS} nuits.` },
    ]);
  }
}

function ratePeriodOverlap(): ConflictError {
  return new ConflictError(
    'RATE_PERIOD_OVERLAP',
    'Période en conflit',
    'Une autre période du même type couvre déjà une partie de ces nuits pour la même ' +
      'catégorie. Modifiez-la ou choisissez d’autres dates.',
  );
}

export class CatalogAdmin {
  readonly #sequelize: Sequelize;
  readonly #repository: CatalogAdminRepository;
  readonly #today: () => string;

  /** `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. */
  constructor(sequelize: Sequelize, today: () => string) {
    this.#sequelize = sequelize;
    this.#repository = new CatalogAdminRepository(sequelize);
    this.#today = today;
  }

  async #audit(
    actor: StaffUser,
    action: string,
    entityType: string,
    entityId: string,
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
        entityType,
        entityId,
        changes,
        ipAddress: origin.ip,
      },
      transaction,
    );
  }

  async #existingCategory(categoryId: string, transaction: Transaction): Promise<void> {
    if ((await this.#repository.findCategory(categoryId, transaction)) === undefined) {
      throw new ValidationError([{ field: 'categoryId', message: 'Catégorie inconnue.' }]);
    }
  }

  // --- Categories ---

  listCategories(): Promise<CategoryAdminView[]> {
    return this.#repository.listCategories();
  }

  async updateCategory(
    actor: StaffUser,
    id: string,
    changes: Changes<CategoryFields>,
    origin: ActionOrigin,
  ): Promise<CategoryAdminView> {
    await this.#sequelize.transaction(async (transaction) => {
      const current = await this.#repository.findCategory(id, transaction, true);
      if (current === undefined) {
        throw new NotFoundError('Cette catégorie n’existe pas.');
      }
      const before: CategoryFields = {
        name: current.name,
        description: current.description,
        beds: current.beds,
        areaSqm: current.areaSqm,
        maxOccupancy: current.maxOccupancy,
        baseOccupancy: current.baseOccupancy,
        basePriceCents: current.basePriceCents,
        extraAdultCents: current.extraAdultCents,
        extraChildCents: current.extraChildCents,
        amenities: current.amenities,
        sortOrder: current.sortOrder,
        isActive: current.isActive,
      };
      const after: CategoryFields = merge(before, changes);
      if (after.baseOccupancy > after.maxOccupancy) {
        throw new ValidationError([
          {
            field: 'baseOccupancy',
            message: 'Le nombre de personnes comprises ne peut pas dépasser la capacité.',
          },
        ]);
      }
      await this.#repository.updateCategory(id, after, transaction);
      await this.#audit(
        actor,
        updateAction('category', before.isActive, after.isActive),
        'room_category',
        id,
        differences(before, after),
        origin,
        transaction,
      );
    });
    return this.#found(await this.#repository.findCategory(id));
  }

  // --- Rooms ---

  listRooms(filter: RoomFilter): Promise<RoomAdminView[]> {
    return this.#repository.listRooms(filter);
  }

  async createRoom(
    actor: StaffUser,
    fields: RoomFields,
    origin: ActionOrigin,
  ): Promise<RoomAdminView> {
    const id = await this.#roomWrite(async (transaction) => {
      await this.#existingCategory(fields.categoryId, transaction);
      const roomId = await this.#repository.insertRoom(fields, transaction);
      await this.#audit(actor, 'room.created', 'room', roomId, { ...fields }, origin, transaction);
      return roomId;
    });
    return this.#found(await this.#repository.findRoom(id));
  }

  async updateRoom(
    actor: StaffUser,
    id: string,
    changes: Changes<RoomFields>,
    origin: ActionOrigin,
  ): Promise<RoomAdminView> {
    await this.#roomWrite(async (transaction) => {
      const current = await this.#repository.findRoom(id, transaction, true);
      if (current === undefined) {
        throw new NotFoundError('Cette chambre n’existe pas.');
      }
      const before: RoomFields = {
        number: current.number,
        floor: current.floor,
        categoryId: current.categoryId,
        isActive: current.isActive,
      };
      const after: RoomFields = merge(before, changes);
      if (after.categoryId !== before.categoryId) {
        await this.#existingCategory(after.categoryId, transaction);
      }
      await this.#repository.updateRoom(id, after, transaction);
      await this.#audit(
        actor,
        updateAction('room', before.isActive, after.isActive),
        'room',
        id,
        differences(before, after),
        origin,
        transaction,
      );
      return id;
    });
    return this.#found(await this.#repository.findRoom(id));
  }

  /** A room number already used gives a clear 409 instead of a server error. */
  async #roomWrite(work: (transaction: Transaction) => Promise<string>): Promise<string> {
    try {
      return await this.#sequelize.transaction(work);
    } catch (error) {
      if (postgresCode(error) === UNIQUE_VIOLATION) {
        throw new ConflictError(
          'ROOM_NUMBER_TAKEN',
          'Numéro déjà utilisé',
          'Une autre chambre porte déjà ce numéro.',
        );
      }
      throw error;
    }
  }

  // --- Rate periods ---

  /** Current and future periods; every period with `includePast`. */
  listRatePeriods(includePast: boolean): Promise<RatePeriodAdminView[]> {
    return this.#repository.listRatePeriods(includePast ? null : this.#today());
  }

  async createRatePeriod(
    actor: StaffUser,
    fields: RatePeriodFields,
    origin: ActionOrigin,
  ): Promise<RatePeriodAdminView> {
    checkNights(fields.firstNight, fields.lastNight);
    const id = await this.#ratePeriodWrite(async (transaction) => {
      if (fields.categoryId !== null) {
        await this.#existingCategory(fields.categoryId, transaction);
      }
      const periodId = await this.#repository.insertRatePeriod(fields, transaction);
      await this.#audit(
        actor,
        'rate_period.created',
        'rate_period',
        periodId,
        { ...fields },
        origin,
        transaction,
      );
      return periodId;
    });
    return this.#found(await this.#repository.findRatePeriod(id));
  }

  async updateRatePeriod(
    actor: StaffUser,
    id: string,
    changes: Changes<RatePeriodFields>,
    origin: ActionOrigin,
  ): Promise<RatePeriodAdminView> {
    await this.#ratePeriodWrite(async (transaction) => {
      const current = await this.#repository.findRatePeriod(id, transaction, true);
      if (current === undefined) {
        throw new NotFoundError('Cette période n’existe pas.');
      }
      const before: RatePeriodFields = {
        name: current.name,
        kind: current.kind,
        firstNight: current.firstNight,
        lastNight: current.lastNight,
        adjustmentPct: current.adjustmentPct,
        categoryId: current.categoryId,
      };
      const after: RatePeriodFields = merge(before, changes);
      checkNights(after.firstNight, after.lastNight);
      if (after.categoryId !== null && after.categoryId !== before.categoryId) {
        await this.#existingCategory(after.categoryId, transaction);
      }
      await this.#repository.updateRatePeriod(id, after, transaction);
      await this.#audit(
        actor,
        'rate_period.updated',
        'rate_period',
        id,
        differences(before, after),
        origin,
        transaction,
      );
      return id;
    });
    return this.#found(await this.#repository.findRatePeriod(id));
  }

  async deleteRatePeriod(actor: StaffUser, id: string, origin: ActionOrigin): Promise<void> {
    await this.#sequelize.transaction(async (transaction) => {
      const current = await this.#repository.findRatePeriod(id, transaction, true);
      if (current === undefined) {
        throw new NotFoundError('Cette période n’existe pas.');
      }
      await this.#repository.deleteRatePeriod(id, transaction);
      // The deleted values stay readable in the audit log.
      await this.#audit(
        actor,
        'rate_period.deleted',
        'rate_period',
        id,
        {
          name: current.name,
          kind: current.kind,
          firstNight: current.firstNight,
          lastNight: current.lastNight,
          adjustmentPct: current.adjustmentPct,
          categoryId: current.categoryId,
        },
        origin,
        transaction,
      );
    });
  }

  /** Two periods of the same kind and scope sharing a night give a clear 409. */
  async #ratePeriodWrite(work: (transaction: Transaction) => Promise<string>): Promise<string> {
    try {
      return await this.#sequelize.transaction(work);
    } catch (error) {
      if (postgresCode(error) === EXCLUSION_VIOLATION) {
        throw ratePeriodOverlap();
      }
      throw error;
    }
  }

  // --- Sales closures ---

  /** Current and future closures (a past closure has no effect any more). */
  listSalesClosures(): Promise<SalesClosureAdminView[]> {
    return this.#repository.listSalesClosures(this.#today());
  }

  async createSalesClosure(
    actor: StaffUser,
    fields: SalesClosureFields,
    origin: ActionOrigin,
  ): Promise<SalesClosureAdminView> {
    checkNights(fields.firstNight, fields.lastNight);
    if (fields.lastNight < this.#today()) {
      throw new ValidationError([
        { field: 'lastNight', message: 'Une fermeture de vente ne peut pas être dans le passé.' },
      ]);
    }
    const id = await this.#sequelize.transaction(async (transaction) => {
      await this.#existingCategory(fields.categoryId, transaction);
      const closureId = await this.#repository.insertSalesClosure(fields, actor.id, transaction);
      await this.#audit(
        actor,
        'sales_closure.created',
        'sales_closure',
        closureId,
        { ...fields },
        origin,
        transaction,
      );
      return closureId;
    });
    return this.#found(await this.#repository.findSalesClosure(id));
  }

  async deleteSalesClosure(actor: StaffUser, id: string, origin: ActionOrigin): Promise<void> {
    await this.#sequelize.transaction(async (transaction) => {
      const current = await this.#repository.findSalesClosure(id, transaction, true);
      if (current === undefined) {
        throw new NotFoundError('Cette fermeture de vente n’existe pas.');
      }
      await this.#repository.deleteSalesClosure(id, transaction);
      await this.#audit(
        actor,
        'sales_closure.deleted',
        'sales_closure',
        id,
        {
          categoryId: current.categoryId,
          firstNight: current.firstNight,
          lastNight: current.lastNight,
          reason: current.reason,
        },
        origin,
        transaction,
      );
    });
  }

  // --- Services ---

  listServices(): Promise<ServiceAdminView[]> {
    return this.#repository.listServices();
  }

  async updateService(
    actor: StaffUser,
    id: string,
    changes: Changes<ServiceFields>,
    origin: ActionOrigin,
  ): Promise<ServiceAdminView> {
    await this.#sequelize.transaction(async (transaction) => {
      const current = await this.#repository.findService(id, transaction, true);
      if (current === undefined) {
        throw new NotFoundError('Ce service n’existe pas.');
      }
      const before: ServiceFields = {
        name: current.name,
        unitPriceCents: current.unitPriceCents,
        pricingUnit: current.pricingUnit,
        vatRate: current.vatRate,
        bookableOnline: current.bookableOnline,
        isActive: current.isActive,
      };
      const after: ServiceFields = merge(before, changes);
      await this.#repository.updateService(id, after, transaction);
      await this.#audit(
        actor,
        updateAction('service', before.isActive, after.isActive),
        'service',
        id,
        differences(before, after),
        origin,
        transaction,
      );
    });
    return this.#found(await this.#repository.findService(id));
  }

  #found<T>(value: T | undefined): T {
    if (value === undefined) {
      throw new NotFoundError();
    }
    return value;
  }
}
