import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { PaymentStatus } from '../domain/reservation-rules.ts';

/** A booking at the end of the hold of its rooms, with its payment page. */
export interface DueBooking {
  reference: string;
  sessionId: string | null;
}

/**
 * What the notifications of the payment service write (step R-5), in plain SQL with bound
 * parameters: the notifications already handled, the payments received online and the
 * confirmation of the bookings waiting for their payment. Only identifiers of Stripe are
 * stored, never any card data.
 */
export class OnlinePaymentRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  /**
   * Notes the notification as handled; false when it already was (Stripe sends some twice).
   * Written in the transaction of its handling: if the handling fails, nothing is kept and
   * the notification sent again by Stripe is handled then. Two copies at the same instant:
   * the second waits on the primary key, then finds the first.
   */
  async recordEvent(eventId: string, type: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.#sequelize.query<{ eventId: string }>(
      `INSERT INTO webhook_events (provider, event_id, type, processed_at)
       VALUES ('stripe', $1, $2, now())
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING event_id AS "eventId"`,
      { bind: [eventId, type], type: QueryTypes.SELECT, transaction },
    );
    return rows.length > 0;
  }

  /**
   * Bookings of the website still waiting for their payment at the end of the hold of their
   * rooms (step R-5b), the oldest first.
   */
  dueUnpaid(now: Date, limit: number): Promise<DueBooking[]> {
    return this.#sequelize.query<DueBooking>(
      `SELECT reference, stripe_checkout_session_id AS "sessionId"
         FROM reservations
        WHERE status = 'pending_payment' AND source = 'website' AND payment_expires_at <= $1
        ORDER BY payment_expires_at
        LIMIT $2`,
      { bind: [now, limit], type: QueryTypes.SELECT },
    );
  }

  /** The stay paid online; once only per payment of Stripe, even notified twice. */
  async recordOnlinePayment(
    reservationId: string,
    payment: { paymentIntentId: string; amountCents: number },
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `INSERT INTO payments (reservation_id, kind, method, amount_cents, status,
                             stripe_payment_intent_id, received_at)
       VALUES ($1, 'payment', 'card_online', $2, 'succeeded', $3, now())
       ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
      { bind: [reservationId, payment.amountCents, payment.paymentIntentId], transaction },
    );
  }

  /** Non-refundable rate: confirmed, the stay paid. Only while it waits for its payment. */
  async confirmPaid(
    reservationId: string,
    paymentStatus: PaymentStatus,
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `UPDATE reservations
          SET status = 'confirmed', payment_status = $2, payment_expires_at = NULL,
              lock_version = lock_version + 1
        WHERE id = $1 AND status = 'pending_payment'`,
      { bind: [reservationId, paymentStatus], transaction },
    );
  }

  /** Flexible rate: confirmed, the card saved as a guarantee (nothing charged). */
  async confirmGuaranteed(
    reservationId: string,
    card: { customerId: string; paymentMethodId: string },
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `UPDATE reservations
          SET status = 'confirmed', stripe_customer_id = $2, stripe_payment_method_id = $3,
              payment_expires_at = NULL, lock_version = lock_version + 1
        WHERE id = $1 AND status = 'pending_payment'`,
      { bind: [reservationId, card.customerId, card.paymentMethodId], transaction },
    );
  }
}
