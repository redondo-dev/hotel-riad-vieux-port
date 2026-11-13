import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { ReservationStatus } from '../domain/reservation-rules.ts';

/** What the page « Gérer ma réservation » adds to the summary of a booking. */
export interface ManagedRecord {
  id: string;
  status: ReservationStatus;
  firstName: string;
  freeCancellationUntil: Date | null;
}

/**
 * The secret links of « Gérer ma réservation » (step M), in plain SQL with bound parameters.
 * Only the SHA-256 fingerprint of a token is stored, with the end of its validity: 30 days
 * after the departure by default (setting « manage_link_days_after_checkout » of the hotel).
 */
export class ManageBookingRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  /**
   * Gives the booking a new link: the previous one, if any, stops working at once. Valid until
   * the end of the day of the departure plus the days of the setting, in Marseille.
   */
  async issueToken(reservationId: string, hash: string, transaction: Transaction): Promise<void> {
    await this.#sequelize.query(
      `UPDATE reservations r
          SET manage_token_hash = $2,
              manage_token_expires_at =
                ((r.check_out + h.manage_link_days_after_checkout + 1)::timestamp
                  AT TIME ZONE 'Europe/Paris')
         FROM hotel_settings h
        WHERE r.id = $1 AND h.id = 1`,
      { bind: [reservationId, hash], transaction },
    );
  }

  /**
   * The booking of the website with this reference and this link still valid at `now`;
   * undefined otherwise (the same for a wrong reference, a wrong token or a link expired). In a
   * transaction, the booking is locked.
   */
  async byToken(
    reference: string,
    hash: string,
    now: Date,
    transaction?: Transaction,
  ): Promise<ManagedRecord | undefined> {
    const rows = await this.#sequelize.query<ManagedRecord>(
      `SELECT r.id, r.status, c.first_name AS "firstName",
              r.free_cancellation_until AS "freeCancellationUntil"
         FROM reservations r
         JOIN customers c ON c.id = r.customer_id
        WHERE r.source = 'website' AND r.reference = $1 AND r.manage_token_hash = $2
          AND r.manage_token_expires_at > $3
        ${transaction === undefined ? '' : 'FOR UPDATE OF r'}`,
      {
        bind: [reference, hash, now],
        type: QueryTypes.SELECT,
        ...(transaction === undefined ? {} : { transaction }),
      },
    );
    return rows[0];
  }
}
