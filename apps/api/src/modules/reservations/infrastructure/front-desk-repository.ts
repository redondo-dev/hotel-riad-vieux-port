import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { RatePlan, ReservationStatus } from '../domain/reservation-rules.ts';

/**
 * The front desk in plain SQL with bound parameters: the arrivals and departures of a day, the
 * rooms of a stay at its arrival, and the changes of state (arrived, departed, no-show).
 */

export interface FrontDeskRoomState {
  id: string;
  number: string;
  housekeepingStatus: 'clean' | 'dirty';
  /** Out of service the night of the day shown. */
  outOfService: boolean;
}

export interface FrontDeskRoom {
  lineId: string;
  categoryName: string;
  room: FrontDeskRoomState | null;
}

export interface FrontDeskStay {
  id: string;
  reference: string;
  status: ReservationStatus;
  version: number;
  ratePlan: RatePlan;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  firstName: string;
  lastName: string;
  adults: number;
  children: number;
  customerMessage: string | null;
  rooms: FrontDeskRoom[];
}

/** A room of a stay as the arrival checks it, on the nights still to come. */
export interface ArrivalRoom {
  lineId: string;
  roomId: string | null;
  number: string | null;
  housekeepingStatus: 'clean' | 'dirty' | null;
  outOfService: boolean;
}

const STAY_SELECT = `
  SELECT r.id, r.reference, r.status, r.lock_version AS version, r.rate_plan AS "ratePlan",
         r.check_in::text AS "checkIn", r.check_out::text AS "checkOut",
         (r.check_out - r.check_in) AS nights, r.total_amount_cents AS "totalCents",
         c.first_name AS "firstName", c.last_name AS "lastName",
         r.customer_message AS "customerMessage",
         (SELECT coalesce(sum(l.adults), 0)::int
            FROM reservation_rooms l WHERE l.reservation_id = r.id) AS adults,
         (SELECT coalesce(sum(cardinality(l.children_ages)), 0)::int
            FROM reservation_rooms l WHERE l.reservation_id = r.id) AS children,
         (SELECT coalesce(json_agg(json_build_object(
                   'lineId', l.id,
                   'categoryName', k.name_fr,
                   'room', CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object(
                     'id', m.id,
                     'number', m.number,
                     'housekeepingStatus', m.housekeeping_status,
                     'outOfService', EXISTS (
                       SELECT 1 FROM room_blocks b
                        WHERE b.room_id = m.id AND b.released_at IS NULL
                          AND b.period @> $1::date)) END)
                 ORDER BY k.sort_order, l.id), '[]'::json)
            FROM reservation_rooms l
            JOIN room_categories k ON k.id = l.category_id
            LEFT JOIN rooms m ON m.id = l.room_id
           WHERE l.reservation_id = r.id) AS rooms
    FROM reservations r
    JOIN customers c ON c.id = r.customer_id`;

export class FrontDeskRepository {
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

  /**
   * Arrivals of `date` (to do, done or no-show), and the confirmed stays whose arrival day has
   * passed without arrival (late guest, or a no-show to declare). To do first.
   */
  arrivals(date: string): Promise<FrontDeskStay[]> {
    return this.#select<FrontDeskStay>(
      `${STAY_SELECT}
        WHERE r.archived_at IS NULL
          AND ((r.check_in = $1::date
                AND r.status IN ('confirmed', 'checked_in', 'checked_out', 'no_show'))
               OR (r.status = 'confirmed' AND r.check_in < $1::date))
        ORDER BY (r.status = 'confirmed') DESC, r.check_in, c.last_name, r.reference`,
      [date],
    );
  }

  /** Departures of `date`, and the guests still in after their departure day. To do first. */
  departures(date: string): Promise<FrontDeskStay[]> {
    return this.#select<FrontDeskStay>(
      `${STAY_SELECT}
        WHERE r.archived_at IS NULL
          AND ((r.check_out = $1::date AND r.status IN ('checked_in', 'checked_out'))
               OR (r.status = 'checked_in' AND r.check_out < $1::date))
        ORDER BY (r.status = 'checked_in') DESC, r.check_out, c.last_name, r.reference`,
      [date],
    );
  }

  /** The rooms of a stay from `from` to its departure: given, clean, in service. */
  arrivalRooms(
    reservationId: string,
    from: string,
    checkOut: string,
    transaction: Transaction,
  ): Promise<ArrivalRoom[]> {
    return this.#select<ArrivalRoom>(
      `SELECT l.id AS "lineId", m.id AS "roomId", m.number,
              m.housekeeping_status AS "housekeepingStatus",
              (m.id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM room_blocks b
                  WHERE b.room_id = m.id AND b.released_at IS NULL
                    AND b.period && daterange($2::date, $3::date, '[)'))) AS "outOfService"
         FROM reservation_rooms l
         LEFT JOIN rooms m ON m.id = l.room_id
        WHERE l.reservation_id = $1 AND l.is_active
        ORDER BY l.id`,
      [reservationId, from, checkOut],
      transaction,
    );
  }

  /** Arrived or departed; the version moves on (another screen open on it must reload). */
  async setStatus(
    id: string,
    status: 'checked_in' | 'checked_out',
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      'UPDATE reservations SET status = $2, lock_version = lock_version + 1 WHERE id = $1',
      [id, status],
      transaction,
    );
  }

  /** No-show: the rooms are released (database trigger), the fee is kept « to collect ». */
  async setNoShow(id: string, feeCents: number, transaction: Transaction): Promise<void> {
    await this.#execute(
      `UPDATE reservations
          SET status = 'no_show', cancellation_fee_cents = $2, lock_version = lock_version + 1
        WHERE id = $1`,
      [id, feeCents],
      transaction,
    );
  }

  /** The rooms the guests leave are to be cleaned. Their numbers, for the audit log. */
  async roomsToClean(reservationId: string, transaction: Transaction): Promise<string[]> {
    const rows = await this.#select<{ number: string }>(
      `UPDATE rooms m SET housekeeping_status = 'dirty'
         FROM reservation_rooms l
        WHERE l.reservation_id = $1 AND l.room_id = m.id
        RETURNING m.number`,
      [reservationId],
      transaction,
    );
    return rows.map((row) => row.number).sort();
  }
}
