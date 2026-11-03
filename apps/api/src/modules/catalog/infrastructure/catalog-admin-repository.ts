import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { PricingUnit, RatePeriodKind } from '../domain/catalog-admin-rules.ts';
import type { LocalizedText } from './catalog-repository.ts';

/**
 * Catalogue as the staff sees it (every row, active or not), in plain SQL with bound
 * parameters. Updates always write the whole row, read and merged beforehand by the service
 * inside the same transaction (row locked with FOR UPDATE): no SQL is built from user input.
 *
 * Periods are stored as [first night, day after the last night); the staff works with the
 * first and the last night, both included. The conversion is done here, in SQL.
 */

export interface CategoryFields {
  name: LocalizedText;
  description: LocalizedText;
  beds: LocalizedText;
  areaSqm: number;
  maxOccupancy: number;
  baseOccupancy: number;
  basePriceCents: number;
  extraAdultCents: number;
  extraChildCents: number;
  amenities: string[];
  sortOrder: number;
  isActive: boolean;
}

export interface CategoryAdminView extends CategoryFields {
  id: string;
  code: string;
  /** Every room of the category, active or not. */
  roomCount: number;
  activeRoomCount: number;
}

export interface RoomFields {
  number: string;
  floor: number;
  categoryId: string;
  isActive: boolean;
}

export interface RoomAdminView extends RoomFields {
  id: string;
  categoryCode: string;
  categoryName: string;
  housekeepingStatus: 'clean' | 'dirty';
  /** Blocked today (incident, maintenance…): not for sale, whatever `isActive` says. */
  outOfService: boolean;
}

export interface RoomFilter {
  categoryId?: string | undefined;
  floor?: number | undefined;
  isActive?: boolean | undefined;
}

export interface RatePeriodFields {
  name: string;
  kind: RatePeriodKind;
  firstNight: string;
  lastNight: string;
  adjustmentPct: number;
  categoryId: string | null;
}

export interface RatePeriodAdminView extends RatePeriodFields {
  id: string;
  categoryCode: string | null;
}

export interface SalesClosureFields {
  categoryId: string;
  firstNight: string;
  lastNight: string;
  reason: string | null;
}

export interface SalesClosureAdminView extends SalesClosureFields {
  id: string;
  categoryCode: string;
  createdAt: Date;
  createdBy: { firstName: string; lastName: string } | null;
}

export interface ServiceFields {
  name: LocalizedText;
  unitPriceCents: number;
  pricingUnit: PricingUnit;
  vatRate: number;
  bookableOnline: boolean;
  isActive: boolean;
}

export interface ServiceAdminView extends ServiceFields {
  id: string;
  code: string;
}

// --- Rows as PostgreSQL returns them (numeric columns come back as text) ---

interface CategoryRow {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  descriptionFr: string;
  descriptionEn: string;
  bedsFr: string;
  bedsEn: string;
  areaSqm: number;
  maxOccupancy: number;
  baseOccupancy: number;
  basePriceCents: number;
  extraAdultCents: number;
  extraChildCents: number;
  amenities: string[];
  sortOrder: number;
  isActive: boolean;
  roomCount: number;
  activeRoomCount: number;
}

interface RatePeriodRow extends Omit<RatePeriodAdminView, 'adjustmentPct'> {
  adjustmentPct: string;
}

interface SalesClosureRow extends Omit<SalesClosureAdminView, 'createdBy'> {
  creatorFirstName: string | null;
  creatorLastName: string | null;
}

interface ServiceRow extends Omit<ServiceAdminView, 'name' | 'vatRate'> {
  nameFr: string;
  nameEn: string;
  vatRate: string;
}

const CATEGORY_SELECT = `
  SELECT c.id, c.code,
         c.name_fr AS "nameFr", c.name_en AS "nameEn",
         c.description_fr AS "descriptionFr", c.description_en AS "descriptionEn",
         c.beds_fr AS "bedsFr", c.beds_en AS "bedsEn",
         c.area_sqm AS "areaSqm", c.max_occupancy AS "maxOccupancy",
         c.base_occupancy AS "baseOccupancy", c.base_price_cents AS "basePriceCents",
         c.extra_adult_cents AS "extraAdultCents", c.extra_child_cents AS "extraChildCents",
         c.amenities, c.sort_order AS "sortOrder", c.is_active AS "isActive",
         (SELECT count(*)::int FROM rooms r WHERE r.category_id = c.id) AS "roomCount",
         (SELECT count(*)::int FROM rooms r WHERE r.category_id = c.id AND r.is_active)
           AS "activeRoomCount"
    FROM room_categories c`;

/**
 * `today` is the bind parameter that holds the current day at the hotel. A released block never
 * counts: one released on the day it started still covers that day (a period is never empty).
 */
function roomSelect(today: string): string {
  return `
  SELECT r.id, r.number, r.floor, r.category_id AS "categoryId", r.is_active AS "isActive",
         r.housekeeping_status AS "housekeepingStatus",
         c.code AS "categoryCode", c.name_fr AS "categoryName",
         EXISTS (SELECT 1 FROM room_blocks b
                  WHERE b.room_id = r.id AND b.released_at IS NULL
                    AND b.period @> ${today}::date) AS "outOfService"
    FROM rooms r
    JOIN room_categories c ON c.id = r.category_id`;
}

const RATE_PERIOD_SELECT = `
  SELECT p.id, p.name, p.kind, p.category_id AS "categoryId", c.code AS "categoryCode",
         lower(p.period)::text AS "firstNight", (upper(p.period) - 1)::text AS "lastNight",
         p.adjustment_pct::text AS "adjustmentPct"
    FROM rate_periods p
    LEFT JOIN room_categories c ON c.id = p.category_id`;

const SALES_CLOSURE_SELECT = `
  SELECT s.id, s.category_id AS "categoryId", c.code AS "categoryCode",
         lower(s.period)::text AS "firstNight", (upper(s.period) - 1)::text AS "lastNight",
         s.reason, s.created_at AS "createdAt",
         u.first_name AS "creatorFirstName", u.last_name AS "creatorLastName"
    FROM sales_closures s
    JOIN room_categories c ON c.id = s.category_id
    LEFT JOIN users u ON u.id = s.created_by`;

const SERVICE_SELECT = `
  SELECT id, code, name_fr AS "nameFr", name_en AS "nameEn",
         unit_price_cents AS "unitPriceCents", pricing_unit AS "pricingUnit",
         vat_rate::text AS "vatRate", bookable_online AS "bookableOnline",
         is_active AS "isActive"
    FROM services`;

function toCategory(row: CategoryRow): CategoryAdminView {
  return {
    id: row.id,
    code: row.code,
    name: { fr: row.nameFr, en: row.nameEn },
    description: { fr: row.descriptionFr, en: row.descriptionEn },
    beds: { fr: row.bedsFr, en: row.bedsEn },
    areaSqm: row.areaSqm,
    maxOccupancy: row.maxOccupancy,
    baseOccupancy: row.baseOccupancy,
    basePriceCents: row.basePriceCents,
    extraAdultCents: row.extraAdultCents,
    extraChildCents: row.extraChildCents,
    amenities: row.amenities,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    roomCount: row.roomCount,
    activeRoomCount: row.activeRoomCount,
  };
}

function toRatePeriod(row: RatePeriodRow): RatePeriodAdminView {
  return { ...row, adjustmentPct: Number(row.adjustmentPct) };
}

function toSalesClosure({
  creatorFirstName,
  creatorLastName,
  ...row
}: SalesClosureRow): SalesClosureAdminView {
  return {
    ...row,
    createdBy:
      creatorFirstName === null || creatorLastName === null
        ? null
        : { firstName: creatorFirstName, lastName: creatorLastName },
  };
}

function toService({ nameFr, nameEn, vatRate, ...row }: ServiceRow): ServiceAdminView {
  return { ...row, name: { fr: nameFr, en: nameEn }, vatRate: Number(vatRate) };
}

function lockClause(lock: boolean): string {
  return lock ? ' FOR UPDATE' : '';
}

export class CatalogAdminRepository {
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

  async #execute(sql: string, bind: unknown[], transaction: Transaction): Promise<void> {
    await this.#sequelize.query(sql, { bind, transaction });
  }

  // --- Categories ---

  async listCategories(): Promise<CategoryAdminView[]> {
    const sql = `${CATEGORY_SELECT} ORDER BY c.sort_order, c.code`;
    const rows = await this.#select<CategoryRow>(sql, []);
    return rows.map(toCategory);
  }

  async findCategory(
    id: string,
    transaction?: Transaction,
    lock = false,
  ): Promise<CategoryAdminView | undefined> {
    const rows = await this.#select<CategoryRow>(
      `${CATEGORY_SELECT} WHERE c.id = $1${lockClause(lock)}`,
      [id],
      transaction,
    );
    const row = rows[0];
    return row === undefined ? undefined : toCategory(row);
  }

  async updateCategory(
    id: string,
    fields: CategoryFields,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE room_categories
          SET name_fr = $2, name_en = $3, description_fr = $4, description_en = $5,
              beds_fr = $6, beds_en = $7, area_sqm = $8, max_occupancy = $9,
              base_occupancy = $10, base_price_cents = $11, extra_adult_cents = $12,
              extra_child_cents = $13, amenities = $14, sort_order = $15, is_active = $16
        WHERE id = $1`,
      [
        id,
        fields.name.fr,
        fields.name.en,
        fields.description.fr,
        fields.description.en,
        fields.beds.fr,
        fields.beds.en,
        fields.areaSqm,
        fields.maxOccupancy,
        fields.baseOccupancy,
        fields.basePriceCents,
        fields.extraAdultCents,
        fields.extraChildCents,
        fields.amenities,
        fields.sortOrder,
        fields.isActive,
      ],
      transaction,
    );
  }

  // --- Rooms ---

  async listRooms(filter: RoomFilter, today: string): Promise<RoomAdminView[]> {
    // Every filter is optional: a missing one is passed as NULL and matches every row.
    const rows = await this.#select<RoomAdminView>(
      `${roomSelect('$4')}
        WHERE ($1::uuid IS NULL OR r.category_id = $1::uuid)
          AND ($2::smallint IS NULL OR r.floor = $2::smallint)
          AND ($3::boolean IS NULL OR r.is_active = $3::boolean)
        ORDER BY r.floor, r.number`,
      [filter.categoryId ?? null, filter.floor ?? null, filter.isActive ?? null, today],
    );
    return rows;
  }

  async findRoom(
    id: string,
    today: string,
    transaction?: Transaction,
    lock = false,
  ): Promise<RoomAdminView | undefined> {
    const rows = await this.#select<RoomAdminView>(
      // FOR UPDATE OF r: only the room is locked, not its category.
      `${roomSelect('$2')} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`,
      [id, today],
      transaction,
    );
    return rows[0];
  }

  async insertRoom(fields: RoomFields, transaction: Transaction): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO rooms (number, floor, category_id, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [fields.number, fields.floor, fields.categoryId, fields.isActive],
      transaction,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('chambre non créée');
    }
    return id;
  }

  async updateRoom(id: string, fields: RoomFields, transaction: Transaction): Promise<void> {
    await this.#execute(
      `UPDATE rooms SET number = $2, floor = $3, category_id = $4, is_active = $5 WHERE id = $1`,
      [id, fields.number, fields.floor, fields.categoryId, fields.isActive],
      transaction,
    );
  }

  /**
   * References of the stays not over yet (departure after `today`) that hold a room, or a room
   * of a category: 5 at most, the nearest first. Cancelled stays no longer hold anything.
   */
  upcomingStays(
    holder: { roomId: string } | { categoryId: string },
    today: string,
    transaction: Transaction,
  ): Promise<{ reference: string }[]> {
    const byRoom = 'roomId' in holder;
    return this.#select<{ reference: string }>(
      `SELECT r.reference
         FROM reservation_rooms l
         JOIN reservations r ON r.id = l.reservation_id
        WHERE l.is_active
          AND r.status IN ('pending_payment', 'confirmed', 'checked_in')
          AND upper(l.stay) > $2::date
          AND (CASE WHEN $3::boolean THEN l.room_id ELSE l.category_id END) = $1::uuid
        GROUP BY r.reference, r.check_in
        ORDER BY r.check_in, r.reference
        LIMIT 5`,
      [byRoom ? holder.roomId : holder.categoryId, today, byRoom],
      transaction,
    );
  }

  // --- Rate periods ---

  /** Periods whose last night is `fromNight` or later; every period when `fromNight` is null. */
  async listRatePeriods(fromNight: string | null): Promise<RatePeriodAdminView[]> {
    const rows = await this.#select<RatePeriodRow>(
      `${RATE_PERIOD_SELECT}
        WHERE $1::date IS NULL OR upper(p.period) > $1::date
        ORDER BY lower(p.period), p.kind, c.code NULLS FIRST`,
      [fromNight],
    );
    return rows.map(toRatePeriod);
  }

  async findRatePeriod(
    id: string,
    transaction?: Transaction,
    lock = false,
  ): Promise<RatePeriodAdminView | undefined> {
    const rows = await this.#select<RatePeriodRow>(
      `${RATE_PERIOD_SELECT} WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`,
      [id],
      transaction,
    );
    const row = rows[0];
    return row === undefined ? undefined : toRatePeriod(row);
  }

  async insertRatePeriod(fields: RatePeriodFields, transaction: Transaction): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO rate_periods (name, kind, period, adjustment_pct, category_id)
       VALUES ($1, $2, daterange($3::date, $4::date + 1, '[)'), $5, $6) RETURNING id`,
      [
        fields.name,
        fields.kind,
        fields.firstNight,
        fields.lastNight,
        fields.adjustmentPct,
        fields.categoryId,
      ],
      transaction,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('période non créée');
    }
    return id;
  }

  async updateRatePeriod(
    id: string,
    fields: RatePeriodFields,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE rate_periods
          SET name = $2, kind = $3, period = daterange($4::date, $5::date + 1, '[)'),
              adjustment_pct = $6, category_id = $7
        WHERE id = $1`,
      [
        id,
        fields.name,
        fields.kind,
        fields.firstNight,
        fields.lastNight,
        fields.adjustmentPct,
        fields.categoryId,
      ],
      transaction,
    );
  }

  async deleteRatePeriod(id: string, transaction: Transaction): Promise<void> {
    await this.#execute('DELETE FROM rate_periods WHERE id = $1', [id], transaction);
  }

  // --- Sales closures ---

  /** Closures whose last night is `fromNight` or later. */
  async listSalesClosures(fromNight: string): Promise<SalesClosureAdminView[]> {
    const rows = await this.#select<SalesClosureRow>(
      `${SALES_CLOSURE_SELECT}
        WHERE upper(s.period) > $1::date
        ORDER BY lower(s.period), c.sort_order, c.code`,
      [fromNight],
    );
    return rows.map(toSalesClosure);
  }

  async findSalesClosure(
    id: string,
    transaction?: Transaction,
    lock = false,
  ): Promise<SalesClosureAdminView | undefined> {
    const rows = await this.#select<SalesClosureRow>(
      `${SALES_CLOSURE_SELECT} WHERE s.id = $1${lock ? ' FOR UPDATE OF s' : ''}`,
      [id],
      transaction,
    );
    const row = rows[0];
    return row === undefined ? undefined : toSalesClosure(row);
  }

  async insertSalesClosure(
    fields: SalesClosureFields,
    createdBy: string,
    transaction: Transaction,
  ): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO sales_closures (category_id, period, reason, created_by)
       VALUES ($1, daterange($2::date, $3::date + 1, '[)'), $4, $5) RETURNING id`,
      [fields.categoryId, fields.firstNight, fields.lastNight, fields.reason, createdBy],
      transaction,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('fermeture non créée');
    }
    return id;
  }

  async deleteSalesClosure(id: string, transaction: Transaction): Promise<void> {
    await this.#execute('DELETE FROM sales_closures WHERE id = $1', [id], transaction);
  }

  // --- Services ---

  async listServices(): Promise<ServiceAdminView[]> {
    const rows = await this.#select<ServiceRow>(`${SERVICE_SELECT} ORDER BY name_fr, code`, []);
    return rows.map(toService);
  }

  async findService(
    id: string,
    transaction?: Transaction,
    lock = false,
  ): Promise<ServiceAdminView | undefined> {
    const rows = await this.#select<ServiceRow>(
      `${SERVICE_SELECT} WHERE id = $1${lockClause(lock)}`,
      [id],
      transaction,
    );
    const row = rows[0];
    return row === undefined ? undefined : toService(row);
  }

  async updateService(id: string, fields: ServiceFields, transaction: Transaction): Promise<void> {
    await this.#execute(
      `UPDATE services
          SET name_fr = $2, name_en = $3, unit_price_cents = $4, pricing_unit = $5,
              vat_rate = $6, bookable_online = $7, is_active = $8
        WHERE id = $1`,
      [
        id,
        fields.name.fr,
        fields.name.en,
        fields.unitPriceCents,
        fields.pricingUnit,
        fields.vatRate,
        fields.bookableOnline,
        fields.isActive,
      ],
      transaction,
    );
  }
}
