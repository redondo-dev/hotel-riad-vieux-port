import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  isIsoDate,
  nowInTimeZone,
  startOfMonth,
} from './dates.js';

describe('isIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isIsoDate('2026-10-31')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects impossible dates and other formats', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('31/10/2026')).toBe(false);
    expect(isIsoDate('2026-1-5')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts nights across the daylight saving time change', () => {
    // France switches to summer time on 29 March 2026: still 2 nights.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('adds months, keeping the day within the target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('returns the first day of the month', () => {
    expect(startOfMonth('2026-10-31')).toBe('2026-10-01');
  });
});

describe('nowInTimeZone', () => {
  it('reads the date and time in Paris, not in UTC', () => {
    // 31 October 2026, 23:30 UTC = 1 November, 00:30 in Paris (winter time, UTC+1).
    const now = nowInTimeZone('Europe/Paris', new Date('2026-10-31T23:30:00Z'));
    expect(now).toEqual({ date: '2026-11-01', minutesOfDay: 30 });
  });
});
