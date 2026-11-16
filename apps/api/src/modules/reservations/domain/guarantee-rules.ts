import type { PaymentStatus, ReservationStatus } from './reservation-rules.ts';

/**
 * The card saved as a guarantee, charged by the management, and the refunds of the payments
 * made online (step D-1). Pure rules: the amount the card may be charged now, whether a payment
 * may still be refunded, and the state of the payment of the reservation.
 */

export type PaymentKind = 'payment' | 'refund';
export type PaymentRecordStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export type PaymentMethod =
  'card_online' | 'card_terminal' | 'cash' | 'bank_transfer' | 'holiday_voucher';

/** One line of the table « payments », as the rules need it. */
export interface PaymentRecord {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentRecordStatus;
  /** Always positive: the direction is given by `kind`. */
  amountCents: number;
  /** null for a payment made at the hotel, or a charge refused before Stripe made one. */
  stripePaymentIntentId: string | null;
  /** The payment a refund gives back; null for a payment. */
  refundedPaymentId: string | null;
}

/** Only these reservations owe fees that the card may pay (RM-15, RM-16, no-show). */
export const CHARGEABLE_STATUSES: readonly ReservationStatus[] = ['cancelled', 'no_show'];

function total(
  payments: readonly PaymentRecord[],
  kind: PaymentKind,
  statuses: readonly PaymentRecordStatus[],
): number {
  return payments
    .filter((payment) => payment.kind === kind && statuses.includes(payment.status))
    .reduce((sum, payment) => sum + payment.amountCents, 0);
}

/** What the hotel keeps: the payments received, less the refunds made or on their way. */
export function netPaidCents(payments: readonly PaymentRecord[]): number {
  return (
    total(payments, 'payment', ['succeeded']) - total(payments, 'refund', ['succeeded', 'pending'])
  );
}

/**
 * A payment made online, received, never refunded (a refund refused does not count): it may be
 * refunded in full, once.
 */
export function isRefundable(payment: PaymentRecord, payments: readonly PaymentRecord[]): boolean {
  if (
    payment.kind !== 'payment' ||
    payment.method !== 'card_online' ||
    payment.status !== 'succeeded' ||
    payment.stripePaymentIntentId === null
  ) {
    return false;
  }
  return !payments.some(
    (other) =>
      other.kind === 'refund' &&
      other.refundedPaymentId === payment.id &&
      (other.status === 'succeeded' || other.status === 'pending'),
  );
}

export interface GuaranteeState {
  status: ReservationStatus;
  /** A card saved at Stripe for this reservation. */
  cardGuarantee: boolean;
  /** Fees of the cancellation or of the no-show, as recorded (0 when waived). */
  feeCents: number;
  payments: readonly PaymentRecord[];
}

/** Why the card may not be charged now, in French for the management; null when it may. */
export function guaranteeChargeRefusal(state: GuaranteeState): string | null {
  if (!CHARGEABLE_STATUSES.includes(state.status)) {
    return 'Seule une réservation annulée ou non présentée peut être débitée sur sa carte.';
  }
  if (!state.cardGuarantee) {
    return 'Aucune carte de garantie n’est enregistrée pour cette réservation.';
  }
  const pending = state.payments.some(
    (payment) => payment.kind === 'payment' && payment.status === 'pending',
  );
  if (pending) {
    return 'Un débit est déjà en cours de traitement : attendez sa confirmation.';
  }
  if (state.feeCents <= 0) {
    return 'Aucun frais n’est dû pour cette réservation.';
  }
  if (state.feeCents - netPaidCents(state.payments) <= 0) {
    return 'Les frais de cette réservation sont déjà réglés.';
  }
  return null;
}

/**
 * The amount the card may be charged now: the fees recorded, less what the hotel already keeps;
 * 0 when it may not be charged. Never typed by the staff (decision « 5a »).
 */
export function guaranteeChargeCents(state: GuaranteeState): number {
  if (guaranteeChargeRefusal(state) !== null) {
    return 0;
  }
  return state.feeCents - netPaidCents(state.payments);
}

/**
 * State of the payment of the reservation after a charge or a refund. What is due: the fees for
 * a reservation cancelled or not shown up for, the whole stay otherwise (the tourist tax being
 * paid at the hotel, a stay paid online stays « partly paid », as at step R-5).
 */
export function paymentStatusOf(reservation: {
  status: ReservationStatus;
  totalCents: number;
  feeCents: number;
  payments: readonly PaymentRecord[];
}): PaymentStatus {
  const { payments } = reservation;
  const paid = total(payments, 'payment', ['succeeded']);
  const refunded = total(payments, 'refund', ['succeeded', 'pending']);
  if (refunded > 0) {
    return paid - refunded <= 0 ? 'refunded' : 'partially_refunded';
  }
  if (paid === 0) {
    return 'unpaid';
  }
  const due = CHARGEABLE_STATUSES.includes(reservation.status)
    ? reservation.feeCents
    : reservation.totalCents;
  return paid >= due ? 'paid' : 'partially_paid';
}
