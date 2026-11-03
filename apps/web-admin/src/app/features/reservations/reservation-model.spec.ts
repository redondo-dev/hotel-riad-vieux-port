import { describe, expect, it } from 'vitest';
import {
  canAssignRoom,
  canCancel,
  canChangeStay,
  formatDifference,
  guestsText,
  parseAges,
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
