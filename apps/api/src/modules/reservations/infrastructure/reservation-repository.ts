import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { PricedCategory } from '../domain/quote.ts';
import type {
  BookingSource,
  PaymentStatus,
  PricingUnit,
  RatePlan,
  ReservationStatus,
} from '../domain/reservation-rules.ts';

/**
 * Reservations, their rooms, nights and charges, their customers and the idempotency keys of
 * their creation, in plain SQL with bound parameters.
 */

export interface PersonName {
  id: string;
  firstName: string;
  lastName: string;
}

export interface BookingSettings {
  checkInTime: string;
  freeCancellationHours: number;
  nonRefundableDiscountPct: number;
  touristTaxCentsPerAdultNight: number;
}

export interface LockedCategory extends PricedCategory {
  code: string;
  name: string;
  isActive: boolean;
}

export interface BookableService {
  id: string;
  name: string;
  unitPriceCents: number;
  pricingUnit: PricingUnit;
  vatRate: number;
}

export interface CustomerFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredLanguage: 'fr' | 'en';
}

export interface CustomerView extends CustomerFields {
  id: string;
}

export interface NewReservation {
  reference: string;
  customerId: string;
  source: BookingSource;
  checkIn: string;
  checkOut: string;
  ratePlan: RatePlan;
  totalCents: number;
  freeCancellationUntil: Date | null;
  customerMessage: string | null;
  internalNotes: string | null;
  createdBy: string;
}

export interface NewReservationRoom {
  categoryId: string;
  adults: number;
  childrenAges: number[];
  babyCot: boolean;
  subtotalCents: number;
  nights: { night: string; priceCents: number; rateLabel: string | null }[];
}

export interface NewCharge {
  kind: 'service' | 'tourist_tax';
  serviceId: string | null;
  label: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  totalCents: number;
}

export interface ReservationRoomView {
  id: string;
  category: { id: string; code: string; name: string };
  room: { id: string; number: string } | null;
  adults: number;
  childrenAges: number[];
  babyCot: boolean;
  subtotalCents: number;
  nights: { night: string; priceCents: number; rateLabel: string | null }[];
}

export interface ChargeView {
  id: string;
  kind: string;
  label: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  totalCents: number;
}

export interface ReservationDetail {
  id: string;
  reference: string;
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  source: string;
  ratePlan: RatePlan;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  freeCancellationUntil: Date | null;
  customerMessage: string | null;
  internalNotes: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  /** Due after a cancellation (RM-15, RM-16): to collect, unless waived by the management. */
  cancellationFeeCents: number;
  /** Increases at each change: sent back to modify the reservation (optimistic lock). */
  version: number;
  createdAt: Date;
  createdBy: PersonName | null;
  customer: CustomerView;
  rooms: ReservationRoomView[];
  charges: ChargeView[];
}

export interface ReservationSummary {
  id: string;
  reference: string;
  customer: { id: string; firstName: string; lastName: string; email: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: { categoryName: string; roomNumber: string | null }[];
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  totalCents: number;
  source: string;
  createdAt: Date;
}

export type ReservationSort = 'checkIn' | 'created' | 'total';

export interface ReservationFilter {
  /** Reference, last name, first name or e-mail. */
  q?: string | undefined;
  status?: ReservationStatus | undefined;
  paymentStatus?: PaymentStatus | undefined;
  source?: string | undefined;
  /** Arrivals from this day included. */
  arrivalFrom?: string | undefined;
  /** Arrivals until this day included. */
  arrivalTo?: string | undefined;
  /** Only the reservations with at least one room without a number. */
  unassigned: boolean;
  sort: ReservationSort;
  page: number;
  pageSize: number;
}

/** The reservation as a change needs it, locked until the end of the transaction. */
export interface LockedReservation {
  id: string;
  reference: string;
  status: ReservationStatus;
  ratePlan: RatePlan;
  checkIn: string;
  checkOut: string;
  version: number;
  freeCancellationUntil: Date | null;
}

export interface LineState {
  id: string;
  categoryId: string;
  roomId: string | null;
  roomNumber: string | null;
  adults: number;
  childrenAges: number[];
  babyCot: boolean;
}

/** A charge that a change of dates or guests may recount (never one already invoiced). */
export interface ChargeState {
  id: string;
  kind: string;
  pricingUnit: PricingUnit | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  invoiced: boolean;
}

export interface StayChange {
  checkIn: string;
  checkOut: string;
  totalCents: number;
  freeCancellationUntil: Date | null;
  internalNotes: string | null;
  customerMessage: string | null;
}

export interface RoomForAssignment {
  id: string;
  number: string;
  categoryId: string;
  isActive: boolean;
}

export interface FreeRoom {
  id: string;
  number: string;
  floor: number;
  housekeepingStatus: 'clean' | 'dirty';
}

export interface LastChange {
  actor: string | null;
  at: Date;
}

export interface StoredResponse {
  requestHash: string;
  status: number | null;
  body: unknown;
}

interface SettingsRow extends Omit<BookingSettings, 'nonRefundableDiscountPct'> {
  nonRefundableDiscountPct: string;
}

interface ServiceRow extends Omit<BookableService, 'vatRate'> {
  vatRate: string;
}

interface ChargeStateRow extends Omit<ChargeState, 'quantity'> {
  quantity: string;
}

interface DetailRow {
  id: string;
  reference: string;
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  source: string;
  ratePlan: RatePlan;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  freeCancellationUntil: Date | null;
  customerMessage: string | null;
  internalNotes: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  cancellationFeeCents: number;
  version: number;
  createdAt: Date;
  creatorId: string | null;
  creatorFirstName: string | null;
  creatorLastName: string | null;
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredLanguage: 'fr' | 'en';
}

interface RoomRow {
  id: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  roomId: string | null;
  roomNumber: string | null;
  adults: number;
  childrenAges: number[];
  babyCot: boolean;
  subtotalCents: number;
}

interface NightRow {
  lineId: string;
  night: string;
  priceCents: number;
  rateLabel: string | null;
}

interface ChargeRow extends Omit<ChargeView, 'quantity' | 'vatRate'> {
  quantity: string;
  vatRate: string;
}

interface SummaryRow extends Omit<ReservationSummary, 'customer'> {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  total: number;
}

/** « dupont » is searched as is: « % » and « _ » typed by someone are not wildcards. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

const SORTS: Record<ReservationSort, string> = {
  checkIn: 'r.check_in, r.reference',
  created: 'r.created_at DESC, r.reference',
  total: 'r.total_amount_cents DESC, r.reference',
};

export class ReservationRepository {
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

  async #execute(sql: string, bind: unknown[], transaction: Transaction): Promise<void> {
    await this.#sequelize.query(sql, { bind, transaction });
  }

  // --- Idempotency ---

  async findIdempotencyKey(key: string): Promise<StoredResponse | undefined> {
    const rows = await this.#select<StoredResponse>(
      `SELECT request_hash AS "requestHash", response_status AS status, response_body AS body
         FROM idempotency_keys
        WHERE key = $1`,
      [key],
    );
    return rows[0];
  }

  /** Fails with a unique violation when the same key is already being used. */
  async claimIdempotencyKey(
    key: string,
    scope: string,
    requestHash: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      'INSERT INTO idempotency_keys (key, scope, request_hash) VALUES ($1, $2, $3)',
      [key, scope, requestHash],
      transaction,
    );
  }

  async storeIdempotentResponse(
    key: string,
    status: number,
    body: unknown,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE idempotency_keys SET response_status = $2, response_body = $3::jsonb
        WHERE key = $1`,
      [key, status, JSON.stringify(body)],
      transaction,
    );
  }

  // --- What a booking reads ---

  async bookingSettings(transaction: Transaction): Promise<BookingSettings | undefined> {
    const rows = await this.#select<SettingsRow>(
      `SELECT check_in_time::text AS "checkInTime",
              free_cancellation_hours AS "freeCancellationHours",
              non_refundable_discount_pct::text AS "nonRefundableDiscountPct",
              tourist_tax_cents_per_adult_night AS "touristTaxCentsPerAdultNight"
         FROM hotel_settings
        WHERE id = 1`,
      [],
      transaction,
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : { ...row, nonRefundableDiscountPct: Number(row.nonRefundableDiscountPct) };
  }

  /**
   * The requested categories, locked until the end of the transaction (always in the same
   * order, so that two bookings never wait for each other): a second booking of the same
   * category waits, then counts the rooms the first one took (RM-03).
   */
  lockCategories(ids: readonly string[], transaction: Transaction): Promise<LockedCategory[]> {
    return this.#select<LockedCategory>(
      `SELECT id, code, name_fr AS name, is_active AS "isActive",
              max_occupancy AS "maxOccupancy", base_occupancy AS "baseOccupancy",
              base_price_cents AS "basePriceCents",
              extra_adult_cents AS "extraAdultCents", extra_child_cents AS "extraChildCents"
         FROM room_categories
        WHERE id = ANY($1::uuid[])
        ORDER BY id
          FOR UPDATE`,
      [ids],
      transaction,
    );
  }

  async activeServices(
    ids: readonly string[],
    transaction: Transaction,
  ): Promise<BookableService[]> {
    const rows = await this.#select<ServiceRow>(
      `SELECT id, name_fr AS name, unit_price_cents AS "unitPriceCents",
              pricing_unit AS "pricingUnit", vat_rate::text AS "vatRate"
         FROM services
        WHERE id = ANY($1::uuid[]) AND is_active`,
      [ids],
      transaction,
    );
    return rows.map((row) => ({ ...row, vatRate: Number(row.vatRate) }));
  }

  async referenceExists(reference: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.#select<{ found: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM reservations WHERE reference = $1) AS found',
      [reference],
      transaction,
    );
    return rows[0]?.found ?? false;
  }

  // --- Customers ---

  /** A customer who can still book: known and not anonymized. */
  async findCustomer(id: string, transaction?: Transaction): Promise<CustomerView | undefined> {
    const rows = await this.#select<CustomerView>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", email::text AS email,
              phone, preferred_language AS "preferredLanguage"
         FROM customers
        WHERE id = $1 AND anonymized_at IS NULL`,
      [id],
      transaction,
    );
    return rows[0];
  }

  async insertCustomer(fields: CustomerFields, transaction: Transaction): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO customers (first_name, last_name, email, phone, preferred_language)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [fields.firstName, fields.lastName, fields.email, fields.phone, fields.preferredLanguage],
      transaction,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('client non créé');
    }
    return id;
  }

  /** Customers whose name or e-mail contains `text`, for the booking form (10 at most). */
  searchCustomers(text: string): Promise<CustomerView[]> {
    return this.#select<CustomerView>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", email::text AS email,
              phone, preferred_language AS "preferredLanguage"
         FROM customers
        WHERE anonymized_at IS NULL
          AND (last_name ILIKE $1 OR first_name ILIKE $1 OR email::text ILIKE $1
               OR (first_name || ' ' || last_name) ILIKE $1)
        ORDER BY lower(last_name), lower(first_name), email
        LIMIT 10`,
      [likePattern(text)],
    );
  }

  // --- Writing a reservation ---

  async insertReservation(fields: NewReservation, transaction: Transaction): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                                 rate_plan, total_amount_cents, free_cancellation_until,
                                 customer_message, internal_notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        fields.reference,
        fields.customerId,
        fields.source,
        fields.checkIn,
        fields.checkOut,
        fields.ratePlan,
        fields.totalCents,
        fields.freeCancellationUntil,
        fields.customerMessage,
        fields.internalNotes,
        fields.createdBy,
      ],
      transaction,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('réservation non créée');
    }
    return id;
  }

  /** One line per booked room (its dates come from the reservation), then its nights. */
  async insertRoom(
    reservationId: string,
    room: NewReservationRoom,
    transaction: Transaction,
  ): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO reservation_rooms (reservation_id, category_id, adults, children_ages,
                                      baby_cot, subtotal_cents)
       VALUES ($1, $2, $3, $4::smallint[], $5, $6)
       RETURNING id`,
      [
        reservationId,
        room.categoryId,
        room.adults,
        room.childrenAges,
        room.babyCot,
        room.subtotalCents,
      ],
      transaction,
    );
    const lineId = rows[0]?.id;
    if (lineId === undefined) {
      throw new Error('ligne de chambre non créée');
    }
    await this.#execute(
      `INSERT INTO reservation_nights (reservation_room_id, night, price_cents, rate_label)
       SELECT $1, night.night, night.price_cents, night.rate_label
         FROM jsonb_to_recordset($2::jsonb)
           AS night (night date, price_cents integer, rate_label text)`,
      [
        lineId,
        JSON.stringify(
          room.nights.map((night) => ({
            night: night.night,
            price_cents: night.priceCents,
            rate_label: night.rateLabel,
          })),
        ),
      ],
      transaction,
    );
    return lineId;
  }

  async insertCharge(
    reservationId: string,
    charge: NewCharge,
    actorId: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `INSERT INTO reservation_charges (reservation_id, kind, service_id, label, quantity,
                                        unit_price_cents, vat_rate, total_cents, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        reservationId,
        charge.kind,
        charge.serviceId,
        charge.label,
        charge.quantity,
        charge.unitPriceCents,
        charge.vatRate,
        charge.totalCents,
        actorId,
      ],
      transaction,
    );
  }

  // --- Changing a reservation ---

  /** Locked until the end of the transaction: two changes of the same reservation queue up. */
  async lockReservation(
    id: string,
    transaction: Transaction,
  ): Promise<LockedReservation | undefined> {
    const rows = await this.#select<LockedReservation>(
      `SELECT id, reference, status, rate_plan AS "ratePlan", check_in::text AS "checkIn",
              check_out::text AS "checkOut", lock_version AS version,
              free_cancellation_until AS "freeCancellationUntil"
         FROM reservations
        WHERE id = $1
          FOR UPDATE`,
      [id],
      transaction,
    );
    return rows[0];
  }

  lines(reservationId: string, transaction: Transaction): Promise<LineState[]> {
    return this.#select<LineState>(
      `SELECT l.id, l.category_id AS "categoryId", l.room_id AS "roomId",
              m.number AS "roomNumber", l.adults, l.children_ages AS "childrenAges",
              l.baby_cot AS "babyCot"
         FROM reservation_rooms l
         LEFT JOIN rooms m ON m.id = l.room_id
        WHERE l.reservation_id = $1
        ORDER BY l.id`,
      [reservationId],
      transaction,
    );
  }

  async charges(reservationId: string, transaction: Transaction): Promise<ChargeState[]> {
    const rows = await this.#select<ChargeStateRow>(
      `SELECT c.id, c.kind, s.pricing_unit AS "pricingUnit", c.quantity::text AS quantity,
              c.unit_price_cents AS "unitPriceCents", c.total_cents AS "totalCents",
              c.invoice_id IS NOT NULL AS invoiced
         FROM reservation_charges c
         LEFT JOIN services s ON s.id = c.service_id
        WHERE c.reservation_id = $1`,
      [reservationId],
      transaction,
    );
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
  }

  /** Price of the first night of each room, and of every night, as frozen at booking. */
  async nightTotals(
    reservationId: string,
    transaction: Transaction,
  ): Promise<{ firstNightsCents: number; nightsCents: number }> {
    const rows = await this.#select<{ firstNightsCents: number; nightsCents: number }>(
      `SELECT coalesce(sum(n.price_cents) FILTER (WHERE n.night = r.check_in), 0)::int
                AS "firstNightsCents",
              coalesce(sum(n.price_cents), 0)::int AS "nightsCents"
         FROM reservations r
         JOIN reservation_rooms l ON l.reservation_id = r.id
         JOIN reservation_nights n ON n.reservation_room_id = l.id
        WHERE r.id = $1`,
      [reservationId],
      transaction,
    );
    return rows[0] ?? { firstNightsCents: 0, nightsCents: 0 };
  }

  /** Dates, total and notes; the dates of the rooms follow (database trigger). */
  async updateStay(id: string, change: StayChange, transaction: Transaction): Promise<void> {
    await this.#execute(
      `UPDATE reservations
          SET check_in = $2, check_out = $3, total_amount_cents = $4,
              free_cancellation_until = $5, internal_notes = $6, customer_message = $7,
              lock_version = lock_version + 1
        WHERE id = $1`,
      [
        id,
        change.checkIn,
        change.checkOut,
        change.totalCents,
        change.freeCancellationUntil,
        change.internalNotes,
        change.customerMessage,
      ],
      transaction,
    );
  }

  /** New guests and new prices of one room: its nights are written again. */
  async rewriteLine(
    lineId: string,
    line: Omit<NewReservationRoom, 'categoryId'>,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE reservation_rooms
          SET adults = $2, children_ages = $3::smallint[], baby_cot = $4, subtotal_cents = $5
        WHERE id = $1`,
      [lineId, line.adults, line.childrenAges, line.babyCot, line.subtotalCents],
      transaction,
    );
    await this.#execute(
      'DELETE FROM reservation_nights WHERE reservation_room_id = $1',
      [lineId],
      transaction,
    );
    await this.#execute(
      `INSERT INTO reservation_nights (reservation_room_id, night, price_cents, rate_label)
       SELECT $1, night.night, night.price_cents, night.rate_label
         FROM jsonb_to_recordset($2::jsonb)
           AS night (night date, price_cents integer, rate_label text)`,
      [
        lineId,
        JSON.stringify(
          line.nights.map((night) => ({
            night: night.night,
            price_cents: night.priceCents,
            rate_label: night.rateLabel,
          })),
        ),
      ],
      transaction,
    );
  }

  async recountCharge(
    chargeId: string,
    quantity: number,
    totalCents: number,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      'UPDATE reservation_charges SET quantity = $2, total_cents = $3 WHERE id = $1',
      [chargeId, quantity, totalCents],
      transaction,
    );
  }

  async deleteCharge(chargeId: string, transaction: Transaction): Promise<void> {
    await this.#execute('DELETE FROM reservation_charges WHERE id = $1', [chargeId], transaction);
  }

  /** Cancelled: its rooms are freed at once (database trigger on the status). */
  async cancel(
    id: string,
    reason: string,
    feeCents: number,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE reservations
          SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2,
              cancellation_fee_cents = $3, lock_version = lock_version + 1
        WHERE id = $1`,
      [id, reason, feeCents],
      transaction,
    );
  }

  /** Who changed the reservation last, and when (audit log): « changed meanwhile by … ». */
  async lastChange(id: string, transaction?: Transaction): Promise<LastChange | undefined> {
    const rows = await this.#select<LastChange>(
      `SELECT CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name || ' ' || u.last_name END
                AS actor,
              a.occurred_at AS at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.entity_type = 'reservation' AND a.entity_id = $1
        ORDER BY a.id DESC
        LIMIT 1`,
      [id],
      transaction,
    );
    return rows[0];
  }

  // --- Rooms of a reservation ---

  async roomForAssignment(
    roomId: string,
    transaction: Transaction,
  ): Promise<RoomForAssignment | undefined> {
    const rows = await this.#select<RoomForAssignment>(
      `SELECT id, number, category_id AS "categoryId", is_active AS "isActive"
         FROM rooms
        WHERE id = $1`,
      [roomId],
      transaction,
    );
    return rows[0];
  }

  /** Blocked (incident, maintenance) on at least one night of the stay; released blocks aside. */
  async roomBlockedDuring(
    roomId: string,
    checkIn: string,
    checkOut: string,
    transaction: Transaction,
  ): Promise<boolean> {
    const rows = await this.#select<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM room_blocks
                       WHERE room_id = $1 AND released_at IS NULL
                         AND period && daterange($2::date, $3::date, '[)')) AS found`,
      [roomId, checkIn, checkOut],
      transaction,
    );
    return rows[0]?.found ?? false;
  }

  /** Reference of another active stay holding the room on one of these nights, if any. */
  async roomTakenDuring(
    roomId: string,
    checkIn: string,
    checkOut: string,
    otherThanReservation: string,
    transaction: Transaction,
  ): Promise<string | undefined> {
    const rows = await this.#select<{ reference: string }>(
      `SELECT r.reference
         FROM reservation_rooms l
         JOIN reservations r ON r.id = l.reservation_id
        WHERE l.room_id = $1 AND l.is_active AND l.reservation_id <> $4
          AND l.stay && daterange($2::date, $3::date, '[)')
        LIMIT 1`,
      [roomId, checkIn, checkOut, otherThanReservation],
      transaction,
    );
    return rows[0]?.reference;
  }

  async setRoom(
    reservationId: string,
    lineId: string,
    roomId: string | null,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      'UPDATE reservation_rooms SET room_id = $2 WHERE id = $1',
      [lineId, roomId],
      transaction,
    );
    await this.#execute(
      'UPDATE reservations SET lock_version = lock_version + 1 WHERE id = $1',
      [reservationId],
      transaction,
    );
  }

  /**
   * Active rooms of the category free on every night of the stay and in service (probes P3
   * and P4), with their cleanliness: what the room selector offers. The room of `lineId`
   * itself is offered too.
   */
  freeRooms(
    categoryId: string,
    checkIn: string,
    checkOut: string,
    lineId: string,
  ): Promise<FreeRoom[]> {
    return this.#select<FreeRoom>(
      `SELECT m.id, m.number, m.floor, m.housekeeping_status AS "housekeepingStatus"
         FROM rooms m
        WHERE m.category_id = $1 AND m.is_active
          AND NOT EXISTS (SELECT 1 FROM room_blocks b
                           WHERE b.room_id = m.id AND b.released_at IS NULL
                             AND b.period && daterange($2::date, $3::date, '[)'))
          AND NOT EXISTS (SELECT 1 FROM reservation_rooms l
                           WHERE l.room_id = m.id AND l.is_active AND l.id <> $4
                             AND l.stay && daterange($2::date, $3::date, '[)'))
        ORDER BY m.floor, m.number`,
      [categoryId, checkIn, checkOut, lineId],
    );
  }

  // --- Reading ---

  async detail(id: string, transaction?: Transaction): Promise<ReservationDetail | undefined> {
    const rows = await this.#select<DetailRow>(
      `SELECT r.id, r.reference, r.status, r.payment_status AS "paymentStatus", r.source,
              r.rate_plan AS "ratePlan", r.check_in::text AS "checkIn",
              r.check_out::text AS "checkOut", (r.check_out - r.check_in) AS nights,
              r.total_amount_cents AS "totalCents",
              r.free_cancellation_until AS "freeCancellationUntil",
              r.customer_message AS "customerMessage", r.internal_notes AS "internalNotes",
              r.cancelled_at AS "cancelledAt", r.cancellation_reason AS "cancellationReason",
              r.cancellation_fee_cents AS "cancellationFeeCents",
              r.lock_version AS version, r.created_at AS "createdAt",
              u.id AS "creatorId", u.first_name AS "creatorFirstName",
              u.last_name AS "creatorLastName",
              c.id AS "customerId", c.first_name AS "firstName", c.last_name AS "lastName",
              c.email::text AS email, c.phone, c.preferred_language AS "preferredLanguage"
         FROM reservations r
         JOIN customers c ON c.id = r.customer_id
         LEFT JOIN users u ON u.id = r.created_by
        WHERE r.id = $1`,
      [id],
      transaction,
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    // One after the other: inside a transaction, the three reads share one connection.
    const rooms = await this.#select<RoomRow>(
      `SELECT l.id, l.category_id AS "categoryId", c.code AS "categoryCode",
              c.name_fr AS "categoryName", l.room_id AS "roomId", m.number AS "roomNumber",
              l.adults, l.children_ages AS "childrenAges", l.baby_cot AS "babyCot",
              l.subtotal_cents AS "subtotalCents"
         FROM reservation_rooms l
         JOIN room_categories c ON c.id = l.category_id
         LEFT JOIN rooms m ON m.id = l.room_id
        WHERE l.reservation_id = $1
        ORDER BY c.sort_order, l.id`,
      [id],
      transaction,
    );
    const nights = await this.#select<NightRow>(
      `SELECT n.reservation_room_id AS "lineId", n.night::text AS night,
              n.price_cents AS "priceCents", n.rate_label AS "rateLabel"
         FROM reservation_nights n
         JOIN reservation_rooms l ON l.id = n.reservation_room_id
        WHERE l.reservation_id = $1
        ORDER BY n.night`,
      [id],
      transaction,
    );
    const charges = await this.#select<ChargeRow>(
      `SELECT id, kind, label, quantity::text AS quantity,
              unit_price_cents AS "unitPriceCents", vat_rate::text AS "vatRate",
              total_cents AS "totalCents"
         FROM reservation_charges
        WHERE reservation_id = $1
        ORDER BY kind = 'tourist_tax', created_at, label`,
      [id],
      transaction,
    );
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      paymentStatus: row.paymentStatus,
      source: row.source,
      ratePlan: row.ratePlan,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      nights: row.nights,
      totalCents: row.totalCents,
      freeCancellationUntil: row.freeCancellationUntil,
      customerMessage: row.customerMessage,
      internalNotes: row.internalNotes,
      cancelledAt: row.cancelledAt,
      cancellationReason: row.cancellationReason,
      cancellationFeeCents: row.cancellationFeeCents,
      version: row.version,
      createdAt: row.createdAt,
      createdBy:
        row.creatorId === null
          ? null
          : {
              id: row.creatorId,
              firstName: row.creatorFirstName ?? '',
              lastName: row.creatorLastName ?? '',
            },
      customer: {
        id: row.customerId,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone,
        preferredLanguage: row.preferredLanguage,
      },
      rooms: rooms.map((room) => ({
        id: room.id,
        category: { id: room.categoryId, code: room.categoryCode, name: room.categoryName },
        room:
          room.roomId === null || room.roomNumber === null
            ? null
            : { id: room.roomId, number: room.roomNumber },
        adults: room.adults,
        childrenAges: room.childrenAges,
        babyCot: room.babyCot,
        subtotalCents: room.subtotalCents,
        nights: nights
          .filter((night) => night.lineId === room.id)
          .map((night) => ({
            night: night.night,
            priceCents: night.priceCents,
            rateLabel: night.rateLabel,
          })),
      })),
      charges: charges.map((charge) => ({
        ...charge,
        quantity: Number(charge.quantity),
        vatRate: Number(charge.vatRate),
      })),
    };
  }

  /** One page of reservations, archived ones left out, with the total count of the filter. */
  async list(filter: ReservationFilter): Promise<{ items: ReservationSummary[]; total: number }> {
    const rows = await this.#select<SummaryRow>(
      `SELECT r.id, r.reference, r.check_in::text AS "checkIn", r.check_out::text AS "checkOut",
              (r.check_out - r.check_in) AS nights, r.status,
              r.payment_status AS "paymentStatus", r.total_amount_cents AS "totalCents",
              r.source, r.created_at AS "createdAt",
              c.id AS "customerId", c.first_name AS "firstName", c.last_name AS "lastName",
              c.email::text AS email,
              (SELECT coalesce(json_agg(json_build_object('categoryName', k.name_fr,
                                                           'roomNumber', m.number)
                                        ORDER BY k.sort_order, l.id), '[]'::json)
                 FROM reservation_rooms l
                 JOIN room_categories k ON k.id = l.category_id
                 LEFT JOIN rooms m ON m.id = l.room_id
                WHERE l.reservation_id = r.id) AS rooms,
              count(*) OVER ()::int AS total
         FROM reservations r
         JOIN customers c ON c.id = r.customer_id
        WHERE r.archived_at IS NULL
          AND ($1::text IS NULL
               OR r.reference = upper($1::text)
               OR c.last_name ILIKE $2 OR c.first_name ILIKE $2 OR c.email::text ILIKE $2
               OR (c.first_name || ' ' || c.last_name) ILIKE $2)
          AND ($3::text IS NULL OR r.status = $3::text)
          AND ($4::text IS NULL OR r.payment_status = $4::text)
          AND ($5::text IS NULL OR r.source = $5::text)
          AND ($6::date IS NULL OR r.check_in >= $6::date)
          AND ($7::date IS NULL OR r.check_in <= $7::date)
          AND (NOT $8::boolean OR EXISTS (SELECT 1 FROM reservation_rooms l
                                          WHERE l.reservation_id = r.id AND l.room_id IS NULL))
        ORDER BY ${SORTS[filter.sort]}
        LIMIT $9 OFFSET $10`,
      [
        filter.q ?? null,
        filter.q === undefined ? null : likePattern(filter.q),
        filter.status ?? null,
        filter.paymentStatus ?? null,
        filter.source ?? null,
        filter.arrivalFrom ?? null,
        filter.arrivalTo ?? null,
        filter.unassigned,
        filter.pageSize,
        (filter.page - 1) * filter.pageSize,
      ],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        customer: {
          id: row.customerId,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
        },
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        nights: row.nights,
        rooms: row.rooms,
        status: row.status,
        paymentStatus: row.paymentStatus,
        totalCents: row.totalCents,
        source: row.source,
        createdAt: row.createdAt,
      })),
      total: rows[0]?.total ?? 0,
    };
  }
}
