import { QueryTypes, type Sequelize } from 'sequelize';
import type { RatePeriod } from '../domain/pricing.ts';

/**
 * Read access to the catalogue, in plain SQL with bound parameters. PostgreSQL returns
 * `numeric` columns as text: they are converted to numbers here, once.
 */

export interface LocalizedText {
  fr: string;
  en: string;
}

export interface HotelSettingsRecord {
  name: string;
  address: string;
  phone: string;
  email: string;
  checkInTime: string;
  checkOutTime: string;
  freeCancellationHours: number;
  nonRefundableDiscountPct: number;
  onlineMaxStayNights: number;
  onlineBookingHorizonDays: number;
  sameDayCutoffTime: string;
}

export interface PublicCategoryRecord {
  id: string;
  code: string;
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
  roomCount: number;
}

export interface OnlineServiceRecord {
  code: string;
  name: LocalizedText;
  unitPriceCents: number;
  pricingUnit: 'per_person_night' | 'per_night' | 'per_stay' | 'per_unit';
}

interface SettingsRow extends Omit<HotelSettingsRecord, 'nonRefundableDiscountPct'> {
  nonRefundableDiscountPct: string;
}

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
  roomCount: number;
}

interface PeriodRow extends Omit<RatePeriod, 'adjustmentPct'> {
  adjustmentPct: string;
}

interface ServiceRow extends Omit<OnlineServiceRecord, 'name'> {
  nameFr: string;
  nameEn: string;
}

export class CatalogRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async #select<T extends object>(sql: string, bind: unknown[] = []): Promise<T[]> {
    return this.#sequelize.query<T>(sql, { bind, type: QueryTypes.SELECT });
  }

  /** The single row of settings; undefined while the hotel is not configured. */
  async findHotelSettings(): Promise<HotelSettingsRecord | undefined> {
    const rows = await this.#select<SettingsRow>(
      `SELECT name, address, phone, email::text AS email,
              check_in_time::text AS "checkInTime", check_out_time::text AS "checkOutTime",
              free_cancellation_hours AS "freeCancellationHours",
              non_refundable_discount_pct::text AS "nonRefundableDiscountPct",
              online_max_stay_nights AS "onlineMaxStayNights",
              online_booking_horizon_days AS "onlineBookingHorizonDays",
              same_day_cutoff_time::text AS "sameDayCutoffTime"
         FROM hotel_settings
        WHERE id = 1`,
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : { ...row, nonRefundableDiscountPct: Number(row.nonRefundableDiscountPct) };
  }

  /**
   * Active categories that have at least one active room (a category without any room cannot be
   * booked, so it is not shown), in display order.
   */
  async listPublicCategories(): Promise<PublicCategoryRecord[]> {
    const rows = await this.#select<CategoryRow>(
      `SELECT c.id, c.code,
              c.name_fr AS "nameFr", c.name_en AS "nameEn",
              c.description_fr AS "descriptionFr", c.description_en AS "descriptionEn",
              c.beds_fr AS "bedsFr", c.beds_en AS "bedsEn",
              c.area_sqm AS "areaSqm", c.max_occupancy AS "maxOccupancy",
              c.base_occupancy AS "baseOccupancy", c.base_price_cents AS "basePriceCents",
              c.extra_adult_cents AS "extraAdultCents", c.extra_child_cents AS "extraChildCents",
              c.amenities, r.room_count AS "roomCount"
         FROM room_categories c
         JOIN (SELECT category_id, count(*)::int AS room_count
                 FROM rooms
                WHERE is_active
                GROUP BY category_id) r ON r.category_id = c.id
        WHERE c.is_active
        ORDER BY c.sort_order, c.code`,
    );
    return rows.map((row) => ({
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
      roomCount: row.roomCount,
    }));
  }

  /** Rate periods sharing at least one night with [firstNight, endDate). */
  async listRatePeriods(firstNight: string, endDate: string): Promise<RatePeriod[]> {
    const rows = await this.#select<PeriodRow>(
      `SELECT kind, category_id AS "categoryId",
              lower(period)::text AS "startDate", upper(period)::text AS "endDate",
              adjustment_pct::text AS "adjustmentPct"
         FROM rate_periods
        WHERE period && daterange($1::date, $2::date, '[)')`,
      [firstNight, endDate],
    );
    return rows.map((row) => ({ ...row, adjustmentPct: Number(row.adjustmentPct) }));
  }

  /** Options that guests can add when booking online. */
  async listOnlineServices(): Promise<OnlineServiceRecord[]> {
    const rows = await this.#select<ServiceRow>(
      `SELECT code, name_fr AS "nameFr", name_en AS "nameEn",
              unit_price_cents AS "unitPriceCents", pricing_unit AS "pricingUnit"
         FROM services
        WHERE is_active AND bookable_online
        ORDER BY name_fr, code`,
    );
    return rows.map((row) => ({
      code: row.code,
      name: { fr: row.nameFr, en: row.nameEn },
      unitPriceCents: row.unitPriceCents,
      pricingUnit: row.pricingUnit,
    }));
  }
}
