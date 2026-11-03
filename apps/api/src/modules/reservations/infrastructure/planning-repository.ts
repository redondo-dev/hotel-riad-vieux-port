import { QueryTypes, type Sequelize } from 'sequelize';
import type { ReservationStatus } from '../domain/reservation-rules.ts';

/**
 * What the planning shows, read in four queries whatever the size of the hotel: categories,
 * rooms, stays and blocks of the period. Dates are « YYYY-MM-DD »; `end` is the day after the
 * last day shown.
 */

export interface PlanningCategoryRow {
  id: string;
  code: string;
  name: string;
}

export interface PlanningRoomRow {
  id: string;
  categoryId: string;
  number: string;
  floor: number;
  housekeepingStatus: 'clean' | 'dirty';
  isActive: boolean;
}

export interface PlanningStayRow {
  reservationId: string;
  lineId: string;
  categoryId: string;
  roomId: string | null;
  reference: string;
  checkIn: string;
  checkOut: string;
  status: ReservationStatus;
  adults: number;
  children: number;
  firstName: string;
  lastName: string;
}

export interface PlanningBlockRow {
  roomId: string;
  from: string;
  /** Day after the last night out of service; null while the end is unknown. */
  to: string | null;
  reason: string;
  incidentId: string | null;
  incidentReference: string | null;
}

export class PlanningRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async #select<T extends object>(sql: string, bind: unknown[] = []): Promise<T[]> {
    return this.#sequelize.query<T>(sql, { bind, type: QueryTypes.SELECT });
  }

  categories(): Promise<PlanningCategoryRow[]> {
    return this.#select<PlanningCategoryRow>(
      `SELECT id, code, name_fr AS name
         FROM room_categories
        ORDER BY sort_order, code`,
    );
  }

  /** Active rooms, and deactivated ones still holding a stay in the period. */
  rooms(start: string, end: string): Promise<PlanningRoomRow[]> {
    return this.#select<PlanningRoomRow>(
      `SELECT m.id, m.category_id AS "categoryId", m.number, m.floor,
              m.housekeeping_status AS "housekeepingStatus", m.is_active AS "isActive"
         FROM rooms m
        WHERE m.is_active
           OR EXISTS (SELECT 1 FROM reservation_rooms l
                       WHERE l.room_id = m.id AND l.is_active
                         AND l.stay && daterange($1::date, $2::date, '[)'))
        ORDER BY m.floor, m.number`,
      [start, end],
    );
  }

  /** Booked rooms of the period, with a room number or not; cancelled ones left out. */
  stays(start: string, end: string): Promise<PlanningStayRow[]> {
    return this.#select<PlanningStayRow>(
      `SELECT r.id AS "reservationId", l.id AS "lineId", l.category_id AS "categoryId",
              l.room_id AS "roomId", r.reference, r.check_in::text AS "checkIn",
              r.check_out::text AS "checkOut", r.status, l.adults,
              cardinality(l.children_ages) AS children,
              c.first_name AS "firstName", c.last_name AS "lastName"
         FROM reservation_rooms l
         JOIN reservations r ON r.id = l.reservation_id
         JOIN customers c ON c.id = r.customer_id
        WHERE l.is_active
          AND l.stay && daterange($1::date, $2::date, '[)')
        ORDER BY r.check_in, r.reference, l.id`,
      [start, end],
    );
  }

  /** Rooms out of service in the period; a released block no longer counts (module 7). */
  blocks(start: string, end: string): Promise<PlanningBlockRow[]> {
    return this.#select<PlanningBlockRow>(
      `SELECT b.room_id AS "roomId", lower(b.period)::text AS "from",
              upper(b.period)::text AS "to", b.reason,
              i.id AS "incidentId", i.reference AS "incidentReference"
         FROM room_blocks b
         LEFT JOIN incidents i ON i.id = b.incident_id
        WHERE b.released_at IS NULL
          AND b.period && daterange($1::date, $2::date, '[)')
        ORDER BY lower(b.period)`,
      [start, end],
    );
  }
}
