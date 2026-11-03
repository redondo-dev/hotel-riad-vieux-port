import { describe, expect, it } from 'vitest';
import { addedNights, cancellationFeeCents, isNightOf, versionOf } from './change-rules.ts';

describe('cancellationFeeCents (RM-15, RM-16)', () => {
  const deadline = new Date('2034-05-08T13:00:00Z');
  const stay = { firstNightsCents: 11_500, nightsCents: 23_000, freeCancellationUntil: deadline };

  it('is free until the deadline at the flexible rate, then the first night', () => {
    const before = new Date('2034-05-08T12:59:59Z');
    const after = new Date('2034-05-08T13:00:01Z');
    expect(cancellationFeeCents({ ...stay, ratePlan: 'flexible', now: before })).toBe(0);
    expect(cancellationFeeCents({ ...stay, ratePlan: 'flexible', now: after })).toBe(11_500);
  });

  it('keeps every night due at the non-refundable rate', () => {
    const now = new Date('2034-04-01T10:00:00Z');
    const fee = cancellationFeeCents({
      ...stay,
      ratePlan: 'non_refundable',
      freeCancellationUntil: null,
      now,
    });
    expect(fee).toBe(23_000);
  });
});

describe('addedNights', () => {
  const stay = { checkIn: '2034-05-10', checkOut: '2034-05-12' };

  it('finds the nights added before and after the stay', () => {
    expect(addedNights(stay, { checkIn: '2034-05-09', checkOut: '2034-05-13' })).toEqual([
      { from: '2034-05-09', to: '2034-05-10' },
      { from: '2034-05-12', to: '2034-05-13' },
    ]);
    expect(addedNights(stay, { checkIn: '2034-05-11', checkOut: '2034-05-12' })).toEqual([]);
  });

  it('takes every night of a stay moved to other dates', () => {
    const moved = { checkIn: '2034-06-01', checkOut: '2034-06-03' };
    expect(addedNights(stay, moved)).toEqual([{ from: '2034-06-01', to: '2034-06-03' }]);
  });

  it('tells whether a night belongs to a stay (arrival in, departure out)', () => {
    expect(isNightOf('2034-05-10', stay)).toBe(true);
    expect(isNightOf('2034-05-12', stay)).toBe(false);
  });
});

describe('versionOf', () => {
  it('reads the version of an If-Match header, with or without quotes', () => {
    expect(versionOf('3')).toBe(3);
    expect(versionOf('"12"')).toBe(12);
    expect(versionOf(undefined)).toBeUndefined();
    expect(versionOf('W/"3"')).toBeUndefined();
    expect(versionOf('trois')).toBeUndefined();
  });
});
