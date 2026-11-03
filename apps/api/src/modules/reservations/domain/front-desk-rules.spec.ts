import { describe, expect, it } from 'vitest';
import {
  checkInProblem,
  checkOutProblem,
  noShowFeeCents,
  noShowProblem,
} from './front-desk-rules.ts';

const STAY = { status: 'confirmed' as const, checkIn: '2034-05-10', checkOut: '2034-05-12' };

describe('checkInProblem', () => {
  it('records the arrival from the arrival day to the day before the departure', () => {
    expect(checkInProblem(STAY, '2034-05-10')).toBeNull();
    // Arrived after midnight.
    expect(checkInProblem(STAY, '2034-05-11')).toBeNull();
    expect(checkInProblem(STAY, '2034-05-09')).toBe(
      'L’arrivée est prévue le 10 mai : trop tôt pour l’enregistrer.',
    );
    expect(checkInProblem(STAY, '2034-05-12')).toMatch(/non-présentation/);
  });

  it('refuses a stay that is not waiting for its guest', () => {
    expect(checkInProblem({ ...STAY, status: 'checked_in' }, '2034-05-10')).toMatch(/confirmée/);
  });
});

describe('checkOutProblem', () => {
  it('records the departure on the day, or later when it was forgotten', () => {
    const staying = { ...STAY, status: 'checked_in' as const };
    expect(checkOutProblem(staying, '2034-05-12')).toBeNull();
    expect(checkOutProblem(staying, '2034-05-13')).toBeNull();
    expect(checkOutProblem(staying, '2034-05-11')).toMatch(/départ anticipé/);
    expect(checkOutProblem(STAY, '2034-05-12')).toMatch(/client arrivé/);
  });
});

describe('noShowProblem and noShowFeeCents (RM-17)', () => {
  it('declares a no-show from the day after the planned arrival', () => {
    expect(noShowProblem(STAY, '2034-05-10')).toMatch(/lendemain/);
    expect(noShowProblem(STAY, '2034-05-11')).toBeNull();
    expect(noShowProblem({ ...STAY, status: 'checked_in' }, '2034-05-11')).toMatch(/confirmée/);
  });

  it('charges the first night (flexible) or every night (non-refundable)', () => {
    const nights = { firstNightsCents: 9500, nightsCents: 19_000 };
    expect(noShowFeeCents('flexible', nights)).toBe(9500);
    expect(noShowFeeCents('non_refundable', nights)).toBe(19_000);
  });
});
