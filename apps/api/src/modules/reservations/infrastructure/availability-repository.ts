import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { PricedCategory, PricingSettings } from '../domain/quote.ts';

/**
 * What the availability of a stay is computed from, in plain SQL with bound parameters.
 * Dates are « YYYY-MM-DD »; `checkOut` is the departure day, so the last night is the day
 * before (RM-01).
 */

export interface BookableCategory extends PricedCategory {
  code: string;
  name: string;
}

export interface FreeRoomsOfNight {
  categoryId: string;
  night: string;
  /** Rooms still to sell; negative when more stays than usable rooms (rooms taken out). */
  free: number;
}

interface SettingsRow {
  nonRefundableDiscountPct: string;
  touristTaxCentsPerAdultNight: number;
}

export class AvailabilityRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async #select<T extends object>(
    sql: string,
    bind: unknown[] = [],
    transaction?: Transaction,
  ): Promise<T[]> {
    return this.#sequelize.query<T>(sql, {
      bind,
      type: QueryTypes.SELECT,
      ...(transaction === undefined ? {} : { transaction }),
    });
  }

  /** undefined while the hotel is not configured. */
  async pricingSettings(): Promise<PricingSettings | undefined> {
    const rows = await this.#select<SettingsRow>(
      `SELECT non_refundable_discount_pct::text AS "nonRefundableDiscountPct",
              tourist_tax_cents_per_adult_night AS "touristTaxCentsPerAdultNight"
         FROM hotel_settings
        WHERE id = 1`,
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : { ...row, nonRefundableDiscountPct: Number(row.nonRefundableDiscountPct) };
  }

  /** Active categories with at least one active room, in display order. */
  categories(): Promise<BookableCategory[]> {
    return this.#select<BookableCategory>(
      `SELECT c.id, c.code, c.name_fr AS name,
              c.max_occupancy AS "maxOccupancy", c.base_occupancy AS "baseOccupancy",
              c.base_price_cents AS "basePriceCents",
              c.extra_adult_cents AS "extraAdultCents", c.extra_child_cents AS "extraChildCents"
         FROM room_categories c
        WHERE c.is_active
          AND EXISTS (SELECT 1 FROM rooms r WHERE r.category_id = c.id AND r.is_active)
        ORDER BY c.sort_order, c.code`,
    );
  }

  /**
   * For each active category and each night: active rooms not blocked that night, less the
   * booked rooms of the category that night (RM-02). A released block never counts: one
   * released on the day it started still covers that day, the room is back on sale. A booked
   * room counts whether a room number is assigned or not, and even if its room is blocked:
   * the guest still needs a room. Inside a booking, `transaction` sees the locks it holds.
   */
  freeRoomsByNight(
    checkIn: string,
    checkOut: string,
    transaction?: Transaction,
  ): Promise<FreeRoomsOfNight[]> {
    return this.#select<FreeRoomsOfNight>(
      `WITH nights AS (
         SELECT day::date AS night
           FROM generate_series($1::date, $2::date - 1, interval '1 day') AS day
       ),
       usable AS (
         SELECT r.category_id, n.night, count(*)::int AS rooms
           FROM rooms r
           CROSS JOIN nights n
          WHERE r.is_active
            AND NOT EXISTS (SELECT 1 FROM room_blocks b
                             WHERE b.room_id = r.id AND b.released_at IS NULL
                               AND b.period @> n.night)
          GROUP BY r.category_id, n.night
       ),
       booked AS (
         SELECT l.category_id, n.night, count(*)::int AS rooms
           FROM reservation_rooms l
           JOIN nights n ON l.stay @> n.night
          WHERE l.is_active
          GROUP BY l.category_id, n.night
       )
       SELECT c.id AS "categoryId", n.night::text AS night,
              coalesce(u.rooms, 0) - coalesce(b.rooms, 0) AS free
         FROM room_categories c
         CROSS JOIN nights n
         LEFT JOIN usable u ON u.category_id = c.id AND u.night = n.night
         LEFT JOIN booked b ON b.category_id = c.id AND b.night = n.night
        WHERE c.is_active
        ORDER BY c.id, n.night`,
      [checkIn, checkOut],
      transaction,
    );
  }

  /** Categories closed to sale on at least one night of the stay (sales_closures). */
  async closedCategoryIds(
    checkIn: string,
    checkOut: string,
    transaction?: Transaction,
  ): Promise<Set<string>> {
    const rows = await this.#select<{ categoryId: string }>(
      `SELECT DISTINCT category_id AS "categoryId"
         FROM sales_closures
        WHERE period && daterange($1::date, $2::date, '[)')`,
      [checkIn, checkOut],
      transaction,
    );
    return new Set(rows.map((row) => row.categoryId));
  }
}
