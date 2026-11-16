import { describe, expect, it } from 'vitest';
import {
  canAssignRoom,
  canCancel,
  canChangeStay,
  canChargeGuarantee,
  canRefund,
  formatDifference,
  freeCancellationText,
  guaranteeStateOf,
  guestsText,
  parseAges,
  paymentBadgesOf,
  paymentLineOf,
  paymentRecordBadge,
  type ReservationDetail,
  roomText,
  stayText,
} from './reservation-model';

/** Intl writes narrow non-breaking spaces: compared here with plain spaces. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

function detail(changes: Partial<ReservationDetail>): ReservationDetail {
  return { status: 'confirmed', ratePlan: 'flexible', ...changes } as ReservationDetail;
}

describe('rights', () => {
  it('lets the reception change and cancel a flexible stay before the arrival', () => {
    expect(canChangeStay(detail({}), 'reception')).toBe(true);
    expect(canCancel(detail({}), 'reception')).toBe(true);
    expect(canChangeStay(detail({ status: 'checked_in' }), 'direction')).toBe(false);
    expect(canCancel(detail({ status: 'cancelled' }), 'direction')).toBe(false);
  });

  it('keeps the non-refundable stays to the management (RM-18)', () => {
    const nonRefundable = detail({ ratePlan: 'non_refundable' });
    expect(canChangeStay(nonRefundable, 'reception')).toBe(false);
    expect(canCancel(nonRefundable, 'reception')).toBe(false);
    expect(canChangeStay(nonRefundable, 'direction')).toBe(true);
  });

  it('gives a room while the guest is expected or staying', () => {
    expect(canAssignRoom(detail({ status: 'checked_in' }))).toBe(true);
    expect(canAssignRoom(detail({ status: 'checked_out' }))).toBe(false);
  });
});

describe('texts', () => {
  it('writes a stay, its guests and its room', () => {
    expect(stayText('2034-05-10', '2034-05-12', 2)).toBe('du 10 au 12 mai 2034 · 2 nuits');
    expect(stayText('2034-05-31', '2034-06-01', 1)).toBe('du 31 mai au 1 juin 2034 · 1 nuit');
    expect(guestsText({ adults: 2, childrenAges: [] })).toBe('2 adultes');
    expect(guestsText({ adults: 2, childrenAges: [6, 3] })).toBe(
      '2 adultes, 2 enfants (6 et 3 ans)',
    );
    expect(guestsText({ adults: 1, childrenAges: [1] })).toBe('1 adulte, 1 enfant (1 an)');
    expect(roomText({ categoryName: 'Double', roomNumber: null })).toBe('Double · à attribuer');
  });

  it('writes the difference of a new price', () => {
    expect(plain(formatDifference(16_200))).toBe('+162,00 €');
    expect(plain(formatDifference(-2000))).toBe('−20,00 €');
    expect(formatDifference(0)).toBe('aucun changement');
  });

  it('says whether the free cancellation is still possible', () => {
    const until = '2034-05-08T13:00:00.000Z';
    const before = new Date('2034-05-08T12:59:00Z');
    const after = new Date('2034-05-08T13:00:00Z');
    expect(plain(freeCancellationText('flexible', until, before))).toBe(
      'Annulation gratuite jusqu’au 8 mai 2034 à 15:00.',
    );
    const late = plain(freeCancellationText('flexible', until, after));
    expect(late).toMatch(/^Annulation gratuite dépassée/);
    expect(freeCancellationText('non_refundable', null, after)).toMatch(/non remboursable/);
  });
});

describe('paymentBadgesOf', () => {
  it('adds « Carte en garantie » to the payment state when a card is saved at Stripe', () => {
    const guaranteed = {
      status: 'confirmed',
      paymentStatus: 'unpaid',
      cardGuarantee: true,
    } as const;
    expect(paymentBadgesOf(guaranteed)).toEqual([
      { label: 'Non payé', className: 'badge-warning' },
      { label: 'Carte en garantie', className: 'badge-info' },
    ]);
    const paid = { status: 'confirmed', paymentStatus: 'paid', cardGuarantee: false } as const;
    expect(paymentBadgesOf(paid)).toEqual([{ label: 'Payé', className: 'badge-ok' }]);
  });

  it('drops « Carte en garantie » once the guarantee is lifted', () => {
    const cancelled = {
      status: 'cancelled',
      paymentStatus: 'unpaid',
      cardGuarantee: true,
    } as const;
    expect(paymentBadgesOf(cancelled)).toEqual([{ label: 'Non payé', className: 'badge-warning' }]);
  });
});

describe('guaranteeStateOf', () => {
  it('keeps the guarantee active until the stay, and for a no-show', () => {
    for (const status of ['pending_payment', 'confirmed', 'checked_in', 'no_show'] as const) {
      expect(guaranteeStateOf({ status, cardGuarantee: true })).toBe('active');
    }
  });

  it('lifts it once cancelled, expired or the stay is over', () => {
    for (const status of ['cancelled', 'expired', 'checked_out'] as const) {
      expect(guaranteeStateOf({ status, cardGuarantee: true })).toBe('lifted');
    }
  });

  it('has no guarantee without a card', () => {
    expect(guaranteeStateOf({ status: 'confirmed', cardGuarantee: false })).toBe('none');
    expect(guaranteeStateOf({ status: 'cancelled', cardGuarantee: false })).toBe('none');
  });
});

describe('parseAges', () => {
  it('reads the ages typed, separated by commas or spaces', () => {
    expect(parseAges('6, 3')).toEqual([6, 3]);
    expect(parseAges(' 12 ')).toEqual([12]);
    expect(parseAges('')).toEqual([]);
  });

  it('refuses an age out of bounds or more than 3 children', () => {
    expect(parseAges('18')).toBeNull();
    expect(parseAges('six')).toBeNull();
    expect(parseAges('1 2 3 4')).toBeNull();
  });
});

describe('payments', () => {
  it('lets only the management charge the card, when the API gives an amount', () => {
    expect(canChargeGuarantee({ guaranteeChargeCents: 10_000 }, 'direction')).toBe(true);
    expect(canChargeGuarantee({ guaranteeChargeCents: 10_000 }, 'reception')).toBe(false);
    expect(canChargeGuarantee({ guaranteeChargeCents: 0 }, 'direction')).toBe(false);
  });

  it('lets only the management refund a payment the API says refundable', () => {
    expect(canRefund({ refundable: true }, 'direction')).toBe(true);
    expect(canRefund({ refundable: true }, 'reception')).toBe(false);
    expect(canRefund({ refundable: false }, 'direction')).toBe(false);
  });

  it('writes a payment and a refund, with their state', () => {
    const paid = paymentLineOf({ kind: 'payment', method: 'card_online', amountCents: 10_000 });
    expect(paid.label).toBe('Carte en ligne');
    expect(plain(paid.amount)).toBe('100,00 €');
    const back = paymentLineOf({ kind: 'refund', method: 'card_online', amountCents: 10_000 });
    expect(back.label).toBe('Remboursement · Carte en ligne');
    expect(plain(back.amount)).toBe('− 100,00 €');
    expect(paymentRecordBadge('failed')).toBe('badge-off');
    expect(paymentRecordBadge('succeeded')).toBe('badge-ok');
  });
});
