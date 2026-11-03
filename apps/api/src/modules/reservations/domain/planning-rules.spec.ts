import { describe, expect, it } from 'vitest';
import { planningPeriodErrors, seesGuestNames } from './planning-rules.ts';

describe('planningPeriodErrors', () => {
  it('accepts one day and up to 31 days', () => {
    expect(planningPeriodErrors('2034-07-01', '2034-07-01')).toEqual([]);
    expect(planningPeriodErrors('2034-07-01', '2034-07-31')).toEqual([]);
  });

  it('refuses an end before the start, and more than 31 days', () => {
    expect(planningPeriodErrors('2034-07-02', '2034-07-01').map((error) => error.field)).toEqual([
      'to',
    ]);
    expect(planningPeriodErrors('2034-07-01', '2034-08-01')).toHaveLength(1);
  });
});

describe('seesGuestNames', () => {
  it('shows the names to management and reception only', () => {
    expect(seesGuestNames('direction')).toBe(true);
    expect(seesGuestNames('reception')).toBe(true);
    expect(seesGuestNames('housekeeping')).toBe(false);
    expect(seesGuestNames('technician')).toBe(false);
  });
});
