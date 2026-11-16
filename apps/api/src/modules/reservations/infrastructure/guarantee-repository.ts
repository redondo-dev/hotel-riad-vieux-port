import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type {
  PaymentKind,
  PaymentMethod,
  PaymentRecord,
  PaymentRecordStatus,
} from '../domain/guarantee-rules.ts';
import type { PaymentStatus, ReservationStatus } from '../domain/reservation-rules.ts';

/**
 * The charges of the saved card and the refunds (step D-1), in plain SQL with bound parameters.
 * A payment is never changed nor deleted (the database refuses it): a refund is a new line.
 * Only identifiers of Stripe are stored, never any card data.
 */

/** The reservation as a charge or a refund needs it, locked until the end of the transaction. */
export interface PaymentLock {
  id: string;
  reference: string;
  status: ReservationStatus;
  totalCents: number;
  feeCents: number;
  /** Customer and card of Stripe; never sent out of the API. */
  customerId: string | null;
  paymentMethodId: string | null;
}

/** A payment as the staff sees it: when, how, how much, and whether it may be refunded. */
export interface PaymentLine extends PaymentRecord {
  receivedAt: Date | null;
  createdAt: Date;
}

export interface NewPayment {
  reservationId: string;
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentRecordStatus;
  amountCents: number;
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
  refundedPaymentId: string | null;
  recordedBy: string;
}

/** The payments of a reservation, the oldest first; also read by the reservation detail. */
export function readPayments(
  sequelize: Sequelize,
  reservationId: string,
  transaction?: Transaction,
): Promise<PaymentLine[]> {
  return sequelize.query<PaymentLine>(
    `SELECT id, kind, method, status, amount_cents AS "amountCents",
            stripe_payment_intent_id AS "stripePaymentIntentId",
            refunded_payment_id AS "refundedPaymentId", received_at AS "receivedAt",
            created_at AS "createdAt"
       FROM payments
      WHERE reservation_id = $1
      ORDER BY created_at, id`,
    { bind: [reservationId], type: QueryTypes.SELECT, ...(transaction ? { transaction } : {}) },
  );
}

export class GuaranteeRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async lock(id: string, transaction: Transaction): Promise<PaymentLock | undefined> {
    const rows = await this.#sequelize.query<PaymentLock>(
      `SELECT id, reference, status, total_amount_cents AS "totalCents",
              cancellation_fee_cents AS "feeCents", stripe_customer_id AS "customerId",
              stripe_payment_method_id AS "paymentMethodId"
         FROM reservations
        WHERE id = $1
          FOR UPDATE`,
      { bind: [id], type: QueryTypes.SELECT, transaction },
    );
    return rows[0];
  }

  payments(reservationId: string, transaction: Transaction): Promise<PaymentLine[]> {
    return readPayments(this.#sequelize, reservationId, transaction);
  }

  /** A payment or a refund; received now when it succeeded. Returns its identifier. */
  async insert(payment: NewPayment, transaction: Transaction): Promise<string> {
    const rows = await this.#sequelize.query<{ id: string }>(
      `INSERT INTO payments (reservation_id, kind, method, amount_cents, status,
                             stripe_payment_intent_id, stripe_refund_id, refunded_payment_id,
                             received_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $5 = 'succeeded' THEN now() END, $9)
       RETURNING id`,
      {
        bind: [
          payment.reservationId,
          payment.kind,
          payment.method,
          payment.amountCents,
          payment.status,
          payment.stripePaymentIntentId,
          payment.stripeRefundId,
          payment.refundedPaymentId,
          payment.recordedBy,
        ],
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('paiement non enregistré');
    }
    return id;
  }

  /** The card saved: charged, or its charge refused (column « guarantee_status », RM-19). */
  async setGuaranteeStatus(
    id: string,
    status: 'charged' | 'failed',
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query('UPDATE reservations SET guarantee_status = $2 WHERE id = $1', {
      bind: [id, status],
      transaction,
    });
  }

  /** The new state of the payment; the version grows, the reservation having changed. */
  async setPaymentStatus(
    id: string,
    status: PaymentStatus,
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `UPDATE reservations SET payment_status = $2, lock_version = lock_version + 1
        WHERE id = $1`,
      { bind: [id, status], transaction },
    );
  }
}
