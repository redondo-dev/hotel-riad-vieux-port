import { describe, expect, it } from 'vitest';
import {
  countedGuests,
  fromSearchQueryParams,
  parseGuests,
  serializeGuests,
  toSearchQueryParams,
  type StaySearchCriteria,
} from './search.js';

describe('guests encoding', () => {
  it('serializes and parses back several rooms', () => {
    const rooms = [
      { adults: 2, childrenAges: [6, 3] },
      { adults: 2, childrenAges: [] },
    ];
    const encoded = serializeGuests(rooms);
    expect(encoded).toBe('2-6-3_2');
    expect(parseGuests(encoded)).toEqual(rooms);
  });

  it('rejects malformed or out-of-range values', () => {
    expect(parseGuests('')).toBeNull();
    expect(parseGuests('0')).toBeNull(); // no adult
    expect(parseGuests('5')).toBeNull(); // more than 4 adults
    expect(parseGuests('2-18')).toBeNull(); // a child of 18 is an adult
    expect(parseGuests('2-1-2-3-4')).toBeNull(); // more than 3 children
    expect(parseGuests('2_2_2_2_2_2')).toBeNull(); // more than 5 rooms
    expect(parseGuests('2-a')).toBeNull();
  });
});

describe('countedGuests', () => {
  it('does not count babies under 2', () => {
    expect(countedGuests({ adults: 2, childrenAges: [1, 0, 5] })).toBe(3);
  });

  it('counts a child whose age is unknown', () => {
    expect(countedGuests({ adults: 2, childrenAges: [null] })).toBe(3);
  });
});

describe('search query parameters', () => {
  const criteria: StaySearchCriteria = {
    checkIn: '2026-11-12',
    checkOut: '2026-11-15',
    rooms: [{ adults: 2, childrenAges: [6] }],
  };

  it('round-trips through URL parameters', () => {
    const params = toSearchQueryParams(criteria);
    expect(params).toEqual({ arrival: '2026-11-12', departure: '2026-11-15', guests: '2-6' });
    expect(fromSearchQueryParams((name) => params[name] ?? null)).toEqual(criteria);
  });

  it('rejects a departure that is not after the arrival', () => {
    const params: Record<string, string> = {
      arrival: '2026-11-15',
      departure: '2026-11-15',
      guests: '2',
    };
    expect(fromSearchQueryParams((name) => params[name] ?? null)).toBeNull();
  });

  it('rejects missing parameters', () => {
    expect(fromSearchQueryParams(() => null)).toBeNull();
  });
});
