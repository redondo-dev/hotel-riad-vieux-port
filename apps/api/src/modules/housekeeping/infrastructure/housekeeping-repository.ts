import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { HousekeepingStatus } from '../domain/housekeeping-rules.ts';

/**
 * Housekeeping state of the ACTIVE rooms (column rooms.housekeeping_status), in plain SQL with
 * bound parameters.
 */

export interface HousekeepingRoom {
  id: string;
  number: string;
  floor: number;
  categoryCode: string;
  categoryName: string;
  status: HousekeepingStatus;
}

export interface HousekeepingFilter {
  floor?: number | undefined;
  status?: HousekeepingStatus | undefined;
}

export interface HousekeepingSummary {
  /** Active rooms of the hotel. */
  total: number;
  /** Among them, rooms to be cleaned. */
  dirty: number;
}

export interface LockedRoom {
  id: string;
  number: string;
  status: HousekeepingStatus;
  isActive: boolean;
}

const ROOM_SELECT = `
  SELECT r.id, r.number, r.floor, c.code AS "categoryCode", c.name_fr AS "categoryName",
         r.housekeeping_status AS status
    FROM rooms r
    JOIN room_categories c ON c.id = r.category_id`;

export class HousekeepingRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async #select<T extends object>(
    sql: string,
    bind: unknown[],
    transaction?: Transaction,
  ): Promise<T[]> {
    return this.#sequelize.query<T>(sql, {
      bind,
      type: QueryTypes.SELECT,
      ...(transaction === undefined ? {} : { transaction }),
    });
  }

  /** Active rooms, by floor then number; each filter is optional (NULL matches every row). */
  listRooms(filter: HousekeepingFilter): Promise<HousekeepingRoom[]> {
    return this.#select<HousekeepingRoom>(
      `${ROOM_SELECT}
        WHERE r.is_active
          AND ($1::smallint IS NULL OR r.floor = $1::smallint)
          AND ($2::text IS NULL OR r.housekeeping_status = $2::text)
        ORDER BY r.floor, r.number`,
      [filter.floor ?? null, filter.status ?? null],
    );
  }

  async summary(): Promise<HousekeepingSummary> {
    const rows = await this.#select<HousekeepingSummary>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE housekeeping_status = 'dirty')::int AS dirty
         FROM rooms
        WHERE is_active`,
      [],
    );
    return rows[0] ?? { total: 0, dirty: 0 };
  }

  listRoomsById(ids: readonly string[]): Promise<HousekeepingRoom[]> {
    return this.#select<HousekeepingRoom>(
      `${ROOM_SELECT} WHERE r.id = ANY($1::uuid[]) ORDER BY r.floor, r.number`,
      [ids],
    );
  }

  /** Locks the rooms until the end of the transaction (two changes never cross). */
  lockRooms(ids: readonly string[], transaction: Transaction): Promise<LockedRoom[]> {
    return this.#select<LockedRoom>(
      `SELECT id, number, housekeeping_status AS status, is_active AS "isActive"
         FROM rooms
        WHERE id = ANY($1::uuid[])
        ORDER BY id
          FOR UPDATE`,
      [ids],
      transaction,
    );
  }

  async setStatus(
    ids: readonly string[],
    status: HousekeepingStatus,
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      'UPDATE rooms SET housekeeping_status = $2 WHERE id = ANY($1::uuid[])',
      { bind: [ids, status], transaction },
    );
  }
}
