import { describe, expect, it } from 'vitest';
import {
  type GuaranteeState,
  guaranteeChargeCents,
  guaranteeChargeRefusal,
  isRefundable,
  netPaidCents,
  type PaymentRecord,
  paymentStatusOf,
} from './guarantee-rules.ts';

let count = 0;

function record(changes: Partial<PaymentRecord>): PaymentRecord {
  count += 1;
  return {
    id: `p${count}`,
    kind: 'payment',
    method: 'card_online',
    status: 'succeeded',
    amountCents: 10_000,
    stripePaymentIntentId: `pi_${count}`,
    refundedPaymentId: null,
    ...changes,
  };
}

function cancelled(changes: Partial<GuaranteeState> = {}): GuaranteeState {
  return { status: 'cancelled', cardGuarantee: true, feeCents: 10_000, payments: [], ...changes };
}

describe('guarantee charge', () => {
  it('charges the fees of a cancellation or a no-show on the saved card', () => {
    expect(guaranteeChargeCents(cancelled())).toBe(10_000);
    expect(guaranteeChargeCents(cancelled({ status: 'no_show', feeCents: 9_500 }))).toBe(9_500);
    expect(guaranteeChargeRefusal(cancelled())).toBeNull();
  });

  it('charges only what is still due, never twice', () => {
    const partly = cancelled({ payments: [record({ amountCents: 4_000 })] });
    expect(guaranteeChargeCents(partly)).toBe(6_000);
    const settled = cancelled({ payments: [record({})] });
    expect(guaranteeChargeCents(settled)).toBe(0);
    expect(guaranteeChargeRefusal(settled)).toMatch(/déjà réglés/);
    // A charge refused leaves the fees due; a refund makes them due again.
    const refused = cancelled({ payments: [record({ status: 'failed' })] });
    expect(guaranteeChargeCents(refused)).toBe(10_000);
  });

  it('refuses a stay to come, without card, without fees or with a charge pending', () => {
    expect(guaranteeChargeRefusal(cancelled({ status: 'confirmed' }))).toMatch(/annulée/);
    expect(guaranteeChargeRefusal(cancelled({ cardGuarantee: false }))).toMatch(/Aucune carte/);
    expect(guaranteeChargeRefusal(cancelled({ feeCents: 0 }))).toMatch(/Aucun frais/);
    const pending = cancelled({ payments: [record({ status: 'pending' })] });
    expect(guaranteeChargeRefusal(pending)).toMatch(/en cours/);
    expect(guaranteeChargeCents(pending)).toBe(0);
  });
});

describe('refunds', () => {
  it('refunds once a payment made online and received', () => {
    const paid = record({});
    expect(isRefundable(paid, [paid])).toBe(true);
    const refund = record({ kind: 'refund', refundedPaymentId: paid.id, status: 'pending' });
    expect(isRefundable(paid, [paid, refund])).toBe(false);
    const refused = record({ kind: 'refund', refundedPaymentId: paid.id, status: 'failed' });
    expect(isRefundable(paid, [paid, refused])).toBe(true);
  });

  it('never refunds a payment made at the hotel, refused, or a refund', () => {
    const cash = record({ method: 'cash', stripePaymentIntentId: null });
    expect(isRefundable(cash, [cash])).toBe(false);
    const failed = record({ status: 'failed' });
    expect(isRefundable(failed, [failed])).toBe(false);
    const refund = record({ kind: 'refund', refundedPaymentId: 'x' });
    expect(isRefundable(refund, [refund])).toBe(false);
  });
});

describe('state of the payment', () => {
  const paid = record({});

  it('follows what is kept against what is due', () => {
    const base = { status: 'cancelled' as const, totalCents: 30_000, feeCents: 10_000 };
    expect(paymentStatusOf({ ...base, payments: [] })).toBe('unpaid');
    expect(paymentStatusOf({ ...base, payments: [paid] })).toBe('paid');
    const half = record({ amountCents: 5_000 });
    expect(paymentStatusOf({ ...base, payments: [half] })).toBe('partially_paid');
    // A stay paid online: the whole stay is due, the tourist tax at the hotel.
    const stay = { status: 'confirmed' as const, totalCents: 10_500, feeCents: 0 };
    expect(paymentStatusOf({ ...stay, payments: [paid] })).toBe('partially_paid');
  });

  it('says refunded, in full or in part', () => {
    const base = { status: 'expired' as const, totalCents: 10_000, feeCents: 0 };
    const back = record({ kind: 'refund', refundedPaymentId: paid.id });
    expect(paymentStatusOf({ ...base, payments: [paid, back] })).toBe('refunded');
    expect(netPaidCents([paid, back])).toBe(0);
    const other = record({ amountCents: 2_000 });
    expect(paymentStatusOf({ ...base, payments: [paid, other, back] })).toBe('partially_refunded');
  });
});
