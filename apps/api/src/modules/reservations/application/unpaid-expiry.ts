import type { Sequelize } from 'sequelize';
import { OnlinePaymentRepository } from '../infrastructure/online-payment-repository.ts';
import { ReservationRepository } from '../infrastructure/reservation-repository.ts';
import type { OnlinePayments, PaymentLog } from './online-payments.ts';
import type { CheckoutOutcome } from './payment-events.ts';
import type { PaymentGateway } from './payment-gateway.ts';

/** Bookings looked at in one run: the next run, a minute later, takes the following ones. */
export const EXPIRY_BATCH_SIZE = 50;

/** What one run did. */
export interface ExpiryReport {
  /** Paid or guaranteed meanwhile: confirmed. */
  confirmed: number;
  /** Never paid: expired, their rooms given back. */
  expired: number;
  /** Stripe did not answer, or the money is still on its way: looked at again next time. */
  kept: number;
}

/**
 * End of the hold of the rooms of the bookings of the website not paid in time (step R-5b,
 * run every minute by the task of main.ts). For each one, Stripe is asked first what the
 * payment page came to (decision « 1a »):
 *  - paid, or card saved: the booking is confirmed, exactly as by the notification;
 *  - still open: the page is closed at Stripe, then the booking expires;
 *  - closed: the booking expires and gives its rooms back.
 * Stripe out of order: the booking is left as it is, and looked at again next time.
 */
export class UnpaidExpiry {
  readonly #sequelize: Sequelize;
  readonly #payments: PaymentGateway | undefined;
  readonly #settlement: OnlinePayments;
  readonly #repository: OnlinePaymentRepository;
  readonly #reservations: ReservationRepository;
  readonly #now: () => Date;
  readonly #log: PaymentLog;

  constructor(options: {
    sequelize: Sequelize;
    /** Without it (no Stripe key in development), the bookings expire without asking. */
    payments: PaymentGateway | undefined;
    settlement: OnlinePayments;
    now: () => Date;
    log: PaymentLog;
  }) {
    this.#sequelize = options.sequelize;
    this.#payments = options.payments;
    this.#settlement = options.settlement;
    this.#repository = new OnlinePaymentRepository(options.sequelize);
    this.#reservations = new ReservationRepository(options.sequelize);
    this.#now = options.now;
    this.#log = options.log;
  }

  async run(): Promise<ExpiryReport> {
    const report: ExpiryReport = { confirmed: 0, expired: 0, kept: 0 };
    const due = await this.#repository.dueUnpaid(this.#now(), EXPIRY_BATCH_SIZE);
    for (const { reference, sessionId } of due) {
      const outcome = await this.#outcomeOf(reference, sessionId);
      if (outcome === undefined || outcome.kind === 'processing') {
        report.kept += 1;
        continue;
      }
      const settled = await this.#sequelize.transaction(async (transaction) => {
        const booking = await this.#reservations.onlineBooking({ reference }, transaction);
        // Settled meanwhile by a notification or by « ← Retour »: nothing more to do.
        if (booking === undefined || booking.status !== 'pending_payment') {
          return false;
        }
        await this.#settlement.settle(booking, outcome, transaction);
        return true;
      });
      if (!settled) {
        continue;
      }
      if (outcome.kind === 'paid' || outcome.kind === 'card_saved') {
        report.confirmed += 1;
      } else {
        report.expired += 1;
      }
    }
    return report;
  }

  /** What Stripe says of the page; undefined when it does not answer. */
  async #outcomeOf(
    reference: string,
    sessionId: string | null,
  ): Promise<CheckoutOutcome | undefined> {
    if (sessionId === null || this.#payments === undefined) {
      return { kind: 'expired' };
    }
    try {
      return await this.#payments.closeCheckout(sessionId);
    } catch (error) {
      this.#log.error(
        { err: error, reference },
        'Stripe : état de la page de paiement inconnu, réservation revue à la prochaine minute',
      );
      return undefined;
    }
  }
}
