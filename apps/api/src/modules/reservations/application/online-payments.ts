import type { Sequelize, Transaction } from 'sequelize';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import { dueNowCents, paymentStatusAfterOnlinePayment } from '../domain/online-booking-rules.ts';
import { OnlinePaymentRepository } from '../infrastructure/online-payment-repository.ts';
import {
  type OnlineBookingRecord,
  ReservationRepository,
} from '../infrastructure/reservation-repository.ts';
import type { CheckoutOutcome, PaymentEvent } from './payment-events.ts';

/** What became of a notification: handled now, already handled, or not for the hotel. */
export type EventHandling = 'processed' | 'duplicate' | 'ignored';

/** Server log: the cases the reception must look at, never shown to a visitor. */
export interface PaymentLog {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * What the payment service tells the hotel about the bookings of the website (step R-5):
 *  - paid (non-refundable rate): the payment is recorded and the booking confirmed;
 *  - card saved (flexible rate): its Stripe identifiers are kept and the booking confirmed;
 *  - page closed, or delayed payment refused: the booking expires and gives its rooms back.
 *
 * Each notification is handled once, in one transaction with the booking locked. A payment
 * received for a booking that no longer holds rooms (decision « 1a »): recorded, but nothing
 * is decided automatically; written to the server log and to the audit log, for the reception
 * to refund it by hand.
 */
export class OnlinePayments {
  readonly #sequelize: Sequelize;
  readonly #reservations: ReservationRepository;
  readonly #payments: OnlinePaymentRepository;
  readonly #log: PaymentLog;

  constructor(options: { sequelize: Sequelize; log: PaymentLog }) {
    this.#sequelize = options.sequelize;
    this.#reservations = new ReservationRepository(options.sequelize);
    this.#payments = new OnlinePaymentRepository(options.sequelize);
    this.#log = options.log;
  }

  async handle(event: PaymentEvent): Promise<EventHandling> {
    return this.#sequelize.transaction(async (transaction) => {
      if (!(await this.#payments.recordEvent(event.id, event.type, transaction))) {
        return 'duplicate';
      }
      if (event.sessionId === null || event.outcome === null) {
        return 'ignored';
      }
      const booking = await this.#reservations.onlineBooking(
        { sessionId: event.sessionId },
        transaction,
      );
      if (booking === undefined) {
        // Another page of the same Stripe account (tests by hand, another site…).
        this.#log.warn(
          { eventId: event.id, sessionId: event.sessionId },
          'Stripe : notification d’une page de paiement inconnue, ignorée',
        );
        return 'ignored';
      }
      await this.settle(booking, event.outcome, transaction);
      return 'processed';
    });
  }

  /**
   * Applies what the payment page came to, the booking being locked by the caller. Also used
   * by the expiry task (step R-5b), when Stripe answers that a page was paid meanwhile.
   */
  async settle(
    booking: OnlineBookingRecord,
    outcome: CheckoutOutcome,
    transaction: Transaction,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'paid':
        await this.#paid(booking, outcome, transaction);
        return;
      case 'card_saved':
        await this.#cardSaved(booking, outcome, transaction);
        return;
      case 'failed':
      case 'expired':
        await this.#expired(booking, outcome.kind, transaction);
        return;
      case 'processing':
        // The money is on its way: the booking keeps waiting until it arrives or fails.
        return;
    }
  }

  async #paid(
    booking: OnlineBookingRecord,
    payment: { paymentIntentId: string; amountCents: number },
    transaction: Transaction,
  ): Promise<void> {
    const expected = dueNowCents(booking.ratePlan, booking.totalCents, booking.touristTaxCents);
    if (payment.amountCents !== expected) {
      this.#log.error(
        { reference: booking.reference, expected, received: payment.amountCents },
        'Stripe : montant payé différent du montant attendu',
      );
    }
    // The money is received whatever the state of the booking: it is always recorded.
    await this.#payments.recordOnlinePayment(booking.id, payment, transaction);

    if (booking.status === 'pending_payment') {
      const paymentStatus = paymentStatusAfterOnlinePayment(booking.touristTaxCents);
      await this.#payments.confirmPaid(booking.id, paymentStatus, transaction);
      await this.#audit(booking, 'reservation.payment_confirmed', transaction, {
        status: { from: 'pending_payment', to: 'confirmed' },
        paymentStatus,
        amountCents: payment.amountCents,
      });
      return;
    }
    if (holdsRooms(booking)) {
      // Confirmed already (the same payment notified again in another way): nothing to do.
      return;
    }
    this.#log.error(
      { reference: booking.reference, status: booking.status, amountCents: payment.amountCents },
      'Stripe : paiement reçu pour une réservation qui ne retient plus de chambre, à rembourser',
    );
    await this.#audit(booking, 'reservation.late_payment', transaction, {
      status: booking.status,
      amountCents: payment.amountCents,
    });
  }

  async #cardSaved(
    booking: OnlineBookingRecord,
    card: { customerId: string; paymentMethodId: string },
    transaction: Transaction,
  ): Promise<void> {
    if (booking.status === 'pending_payment') {
      await this.#payments.confirmGuaranteed(booking.id, card, transaction);
      await this.#audit(booking, 'reservation.guarantee_saved', transaction, {
        status: { from: 'pending_payment', to: 'confirmed' },
      });
      return;
    }
    if (holdsRooms(booking)) {
      return;
    }
    // Nothing was charged: nothing to refund, the reception may call the customer.
    this.#log.warn(
      { reference: booking.reference, status: booking.status },
      'Stripe : carte enregistrée pour une réservation qui ne retient plus de chambre',
    );
    await this.#audit(booking, 'reservation.late_guarantee', transaction, {
      status: booking.status,
    });
  }

  async #expired(
    booking: OnlineBookingRecord,
    reason: 'failed' | 'expired',
    transaction: Transaction,
  ): Promise<void> {
    if (booking.status !== 'pending_payment') {
      return;
    }
    await this.#reservations.expireUnpaid(booking.id, transaction);
    await this.#audit(booking, 'reservation.payment_expired', transaction, {
      status: { from: 'pending_payment', to: 'expired' },
      reason,
    });
  }

  async #audit(
    booking: OnlineBookingRecord,
    action: string,
    transaction: Transaction,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await recordAudit(
      this.#sequelize,
      { actorType: 'system', action, entityType: 'reservation', entityId: booking.id, changes },
      transaction,
    );
  }
}

/** Still holding its rooms: confirmed, or the stay begun or over. */
function holdsRooms(booking: OnlineBookingRecord): boolean {
  return (
    booking.status === 'confirmed' ||
    booking.status === 'checked_in' ||
    booking.status === 'checked_out'
  );
}
