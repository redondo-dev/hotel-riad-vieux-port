import type { Sequelize, Transaction } from 'sequelize';
import { AppError, ConflictError, NotFoundError } from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import {
  guaranteeChargeCents,
  guaranteeChargeRefusal,
  isRefundable,
  paymentStatusOf,
} from '../domain/guarantee-rules.ts';
import {
  GuaranteeRepository,
  type PaymentLine,
  type PaymentLock,
} from '../infrastructure/guarantee-repository.ts';
import {
  type ReservationDetail,
  ReservationRepository,
} from '../infrastructure/reservation-repository.ts';
import type { CardGateway, ChargeFailure, ChargeResult } from './card-gateway.ts';
import type { PaymentLog } from './online-payments.ts';
import type { ActionOrigin } from './reservation-service.ts';

/** What the staff reads when the bank refuses the charge, and what to do then. */
const FAILURE_TEXTS: Record<ChargeFailure, string> = {
  declined: 'Carte refusée par la banque',
  insufficient_funds: 'Provision insuffisante sur la carte',
  expired_card: 'Carte expirée',
  authentication_required:
    'La banque demande une validation du client (3-D Secure), impossible à distance',
  other: 'Débit refusé par le service de paiement',
};

export class CardChargeFailedError extends AppError {
  constructor(failure: ChargeFailure) {
    super({
      status: 402,
      code: 'CARD_CHARGE_FAILED',
      title: 'Débit refusé',
      detail: `${FAILURE_TEXTS[failure]} : demandez au client un autre moyen de paiement.`,
    });
  }
}

export class CardPaymentsNotConfiguredError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'PAYMENT_NOT_CONFIGURED',
      title: 'Paiement par carte indisponible',
      detail: 'Le service de paiement n’est pas configuré : aucun débit ni remboursement possible.',
    });
  }
}

export class CardPaymentsUnavailableError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'PAYMENT_UNAVAILABLE',
      title: 'Service de paiement momentanément indisponible',
      detail:
        'Le service de paiement ne répond pas. Réessayez dans quelques minutes : la même ' +
        'opération n’est jamais faite deux fois.',
    });
  }
}

export class RefundFailedError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'REFUND_FAILED',
      title: 'Remboursement refusé',
      detail:
        'Le service de paiement a refusé ce remboursement : voyez-le dans son tableau de bord.',
    });
  }
}

export interface GuaranteePaymentsOptions {
  sequelize: Sequelize;
  /** Stripe, or a fake in the tests; without it, every charge and refund answers 503. */
  cards?: CardGateway | undefined;
  log: PaymentLog;
}

/**
 * The management charges the card saved as a guarantee with the fees of a cancellation or of a
 * no-show, and refunds a payment made online in full (step D-1). Each operation locks the
 * reservation, so that two clicks never charge twice; the payment service is called inside,
 * with a key of idempotency counted from the attempts already recorded. A charge refused is
 * recorded (with its reason in the audit log) before the error is answered.
 */
export class GuaranteePayments {
  readonly #sequelize: Sequelize;
  readonly #cards: CardGateway | undefined;
  readonly #log: PaymentLog;
  readonly #repository: GuaranteeRepository;
  readonly #reservations: ReservationRepository;

  constructor(options: GuaranteePaymentsOptions) {
    this.#sequelize = options.sequelize;
    this.#cards = options.cards;
    this.#log = options.log;
    this.#repository = new GuaranteeRepository(options.sequelize);
    this.#reservations = new ReservationRepository(options.sequelize);
  }

  async charge(actor: StaffUser, id: string, origin: ActionOrigin): Promise<ReservationDetail> {
    const cards = this.#gateway();
    const outcome = await this.#sequelize.transaction(async (transaction) => {
      const booking = await this.#locked(id, transaction);
      const payments = await this.#repository.payments(id, transaction);
      const state = {
        status: booking.status,
        cardGuarantee: booking.paymentMethodId !== null,
        feeCents: booking.feeCents,
        payments,
      };
      const refusal = guaranteeChargeRefusal(state);
      const { customerId, paymentMethodId } = booking;
      if (refusal !== null || customerId === null || paymentMethodId === null) {
        const detail = refusal ?? 'Aucune carte de garantie n’est enregistrée.';
        throw new ConflictError('CHARGE_NOT_ALLOWED', 'Débit impossible', detail);
      }
      const amountCents = guaranteeChargeCents(state);
      const attempt = payments.filter((payment) => payment.kind === 'payment').length + 1;
      const result = await this.#call(() =>
        cards.chargeSavedCard({
          reservationId: id,
          reference: booking.reference,
          customerId,
          paymentMethodId,
          amountCents,
          description: `${feeLabel(booking)} ${booking.reference}`,
          idempotencyKey: `guarantee-${id}-${String(attempt)}`,
        }),
      );
      await this.#repository.insert(
        {
          reservationId: id,
          kind: 'payment',
          method: 'card_online',
          status: result.status,
          amountCents,
          stripePaymentIntentId: result.paymentIntentId,
          stripeRefundId: null,
          refundedPaymentId: null,
          recordedBy: actor.id,
        },
        transaction,
      );
      await this.#updateStatus(booking, transaction);
      if (result.status !== 'pending') {
        const guarantee = result.status === 'succeeded' ? 'charged' : 'failed';
        await this.#repository.setGuaranteeStatus(id, guarantee, transaction);
      }
      await this.#audit(actor, origin, id, chargeAuditOf(result, amountCents), transaction);
      return result;
    });
    if (outcome.status === 'failed') {
      throw new CardChargeFailedError(outcome.failure);
    }
    return this.#detail(id);
  }

  async refund(
    actor: StaffUser,
    id: string,
    paymentId: string,
    origin: ActionOrigin,
  ): Promise<ReservationDetail> {
    const cards = this.#gateway();
    const status = await this.#sequelize.transaction(async (transaction) => {
      const booking = await this.#locked(id, transaction);
      const payments = await this.#repository.payments(id, transaction);
      const payment = payments.find((line) => line.id === paymentId);
      if (payment === undefined) {
        throw new NotFoundError('Ce paiement ne fait pas partie de la réservation.');
      }
      if (!isRefundable(payment, payments) || payment.stripePaymentIntentId === null) {
        throw new ConflictError(
          'NOT_REFUNDABLE',
          'Remboursement impossible',
          'Seul un paiement en ligne reçu et pas encore remboursé peut être remboursé.',
        );
      }
      const paymentIntentId = payment.stripePaymentIntentId;
      const attempt = refundsOf(payment, payments) + 1;
      const result = await this.#call(() =>
        cards.refund({
          reservationId: id,
          paymentIntentId,
          amountCents: payment.amountCents,
          idempotencyKey: `refund-${payment.id}-${String(attempt)}`,
        }),
      );
      await this.#repository.insert(
        {
          reservationId: id,
          kind: 'refund',
          method: 'card_online',
          status: result.status,
          amountCents: payment.amountCents,
          stripePaymentIntentId: null,
          stripeRefundId: result.refundId,
          refundedPaymentId: payment.id,
          recordedBy: actor.id,
        },
        transaction,
      );
      await this.#updateStatus(booking, transaction);
      await this.#audit(
        actor,
        origin,
        id,
        {
          action: 'reservation.refunded',
          changes: {
            paymentId: payment.id,
            amountCents: payment.amountCents,
            status: result.status,
          },
        },
        transaction,
      );
      return result.status;
    });
    if (status === 'failed') {
      throw new RefundFailedError();
    }
    return this.#detail(id);
  }

  #gateway(): CardGateway {
    if (this.#cards === undefined) {
      throw new CardPaymentsNotConfiguredError();
    }
    return this.#cards;
  }

  /** The payment service not answering: nothing is recorded, the same key is used again. */
  async #call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.#log.error({ err: error }, 'Stripe : débit ou remboursement sans réponse');
      throw new CardPaymentsUnavailableError();
    }
  }

  async #locked(id: string, transaction: Transaction): Promise<PaymentLock> {
    const booking = await this.#repository.lock(id, transaction);
    if (booking === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    return booking;
  }

  async #updateStatus(booking: PaymentLock, transaction: Transaction): Promise<void> {
    const payments = await this.#repository.payments(booking.id, transaction);
    const status = paymentStatusOf({ ...booking, payments });
    await this.#repository.setPaymentStatus(booking.id, status, transaction);
  }

  async #audit(
    actor: StaffUser,
    origin: ActionOrigin,
    reservationId: string,
    entry: { action: string; changes: Record<string, unknown> },
    transaction: Transaction,
  ): Promise<void> {
    await recordAudit(
      this.#sequelize,
      {
        actorType: 'staff',
        actorUserId: actor.id,
        action: entry.action,
        entityType: 'reservation',
        entityId: reservationId,
        changes: entry.changes,
        ipAddress: origin.ip,
      },
      transaction,
    );
  }

  async #detail(id: string): Promise<ReservationDetail> {
    const detail = await this.#reservations.detail(id);
    if (detail === undefined) {
      throw new NotFoundError('Cette réservation n’existe pas.');
    }
    return detail;
  }
}

/** « Frais d'annulation », « Frais de non-présentation ». */
function feeLabel(booking: PaymentLock): string {
  return booking.status === 'no_show' ? 'Frais de non-présentation' : 'Frais d’annulation';
}

/** Refunds already asked for this payment, refused ones included. */
function refundsOf(payment: PaymentLine, payments: readonly PaymentLine[]): number {
  const refunds = payments.filter(
    (line) => line.kind === 'refund' && line.refundedPaymentId === payment.id,
  );
  return refunds.length;
}

function chargeAuditOf(
  result: ChargeResult,
  amountCents: number,
): { action: string; changes: Record<string, unknown> } {
  if (result.status === 'failed') {
    return {
      action: 'reservation.guarantee_charge_failed',
      changes: { amountCents, failure: result.failure },
    };
  }
  return {
    action: 'reservation.guarantee_charged',
    changes: { amountCents, status: result.status },
  };
}
