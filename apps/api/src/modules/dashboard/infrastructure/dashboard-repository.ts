import { QueryTypes, type Sequelize } from 'sequelize';
import type { PeriodCounts } from '../domain/dashboard-rules.ts';

const NOTHING: PeriodCounts = {
  roomNightsAvailable: 0,
  roomNightsSold: 0,
  nightsRevenueCents: 0,
  feesCents: 0,
};

/**
 * The counts of the dashboard in plain SQL with bound parameters, one query per period whatever
 * the size of the hotel. A night is counted on the date it starts (« night of 3 May »).
 */
export class DashboardRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  /**
   * The nights from `from` (included) to `to` (excluded). Sold: the booked rooms still holding
   * their nights (cancelled, no-show and expired stays release them: database trigger).
   */
  async period(from: string, to: string): Promise<PeriodCounts> {
    const rows = await this.#sequelize.query<PeriodCounts>(
      `WITH nights AS (
         SELECT night::date AS night
           FROM generate_series($1::date, $2::date - 1, interval '1 day') AS night
       )
       SELECT
         (SELECT count(*)::int
            FROM nights n
            JOIN rooms m ON m.is_active
           WHERE NOT EXISTS (SELECT 1 FROM room_blocks b
                              WHERE b.room_id = m.id AND b.released_at IS NULL
                                AND b.period @> n.night)) AS "roomNightsAvailable",
         (SELECT count(*)::int
            FROM nights n
            JOIN reservation_rooms l ON l.is_active AND l.stay @> n.night) AS "roomNightsSold",
         (SELECT coalesce(sum(x.price_cents), 0)::int
            FROM reservation_nights x
            JOIN reservation_rooms l ON l.id = x.reservation_room_id AND l.is_active
           WHERE x.night >= $1::date AND x.night < $2::date) AS "nightsRevenueCents",
         (SELECT coalesce(sum(r.cancellation_fee_cents), 0)::int
            FROM reservations r
           WHERE r.status IN ('cancelled', 'no_show')
             AND r.check_in >= $1::date AND r.check_in < $2::date) AS "feesCents"`,
      { bind: [from, to], type: QueryTypes.SELECT },
    );
    return rows[0] ?? NOTHING;
  }

  /** Incidents not resolved yet, and how many of them are urgent. */
  async openIncidents(): Promise<{ open: number; urgent: number }> {
    const rows = await this.#sequelize.query<{ open: number; urgent: number }>(
      `SELECT count(*)::int AS open,
              (count(*) FILTER (WHERE priority = 'urgent'))::int AS urgent
         FROM incidents
        WHERE status IN ('reported', 'in_progress')`,
      { type: QueryTypes.SELECT },
    );
    return rows[0] ?? { open: 0, urgent: 0 };
  }
}
