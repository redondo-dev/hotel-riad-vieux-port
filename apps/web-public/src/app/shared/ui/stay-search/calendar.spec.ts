import { describe, expect, it } from 'vitest';
import {
  buildMonth,
  dateAfterKey,
  formatTypedDate,
  parseTypedDate,
  weekdayNames,
} from './calendar';

describe('buildMonth', () => {
  it('starts weeks on Monday and pads with empty cells', () => {
    // 1 October 2026 is a Thursday: 3 empty cells before it.
    const month = buildMonth('2026-10-17');
    expect(month.start).toBe('2026-10-01');
    expect(month.weeks).toHaveLength(5);
    expect(month.weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(month.weeks[4]).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      null,
    ]);
  });

  it('handles a February of a leap year', () => {
    const month = buildMonth('2028-02-10');
    const days = month.weeks.flat().filter((day) => day !== null);
    expect(days).toHaveLength(29);
  });
});

describe('weekdayNames', () => {
  it('lists the days from Monday', () => {
    const names = weekdayNames('fr-FR');
    expect(names).toHaveLength(7);
    expect(names[0]?.long).toBe('lundi');
    expect(names[6]?.long).toBe('dimanche');
  });
});

describe('typed dates', () => {
  it('reads DD/MM/YYYY and its variants', () => {
    expect(parseTypedDate('12/05/2027')).toBe('2027-05-12');
    expect(parseTypedDate(' 1.6.2027 ')).toBe('2027-06-01');
    expect(parseTypedDate('01-06-2027')).toBe('2027-06-01');
  });

  it('rejects impossible or incomplete dates', () => {
    expect(parseTypedDate('31/02/2027')).toBeNull();
    expect(parseTypedDate('12/05/27')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
  });

  it('writes DD/MM/YYYY', () => {
    expect(formatTypedDate('2027-05-12')).toBe('12/05/2027');
  });
});

describe('dateAfterKey', () => {
  // 28 October 2026 is a Wednesday.
  it('moves by day, week and month', () => {
    expect(dateAfterKey('2026-10-28', 'ArrowRight')).toBe('2026-10-29');
    expect(dateAfterKey('2026-10-28', 'ArrowUp')).toBe('2026-10-21');
    expect(dateAfterKey('2026-10-28', 'PageDown')).toBe('2026-11-28');
  });

  it('goes to the start and end of the week', () => {
    expect(dateAfterKey('2026-10-28', 'Home')).toBe('2026-10-26');
    expect(dateAfterKey('2026-10-28', 'End')).toBe('2026-11-01');
  });

  it('ignores other keys', () => {
    expect(dateAfterKey('2026-10-28', 'a')).toBeNull();
  });
});
