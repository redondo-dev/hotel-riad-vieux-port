import { describe, expect, it } from 'vitest';
import {
  validateStaySearch,
  type StaySearchDraft,
  type StaySearchRules,
} from './stay-search-rules.js';

const rules: StaySearchRules = {
  maxStayNights: 30,
  bookingHorizonDays: 365,
  sameDayCutoffMinutes: 23 * 60,
};
const now = { date: '2026-10-31', minutesOfDay: 14 * 60 };

function draft(overrides: Partial<StaySearchDraft> = {}): StaySearchDraft {
  return {
    checkIn: '2026-11-12',
    checkOut: '2026-11-15',
    rooms: [{ adults: 2, childrenAges: [] }],
    ...overrides,
  };
}

describe('validateStaySearch', () => {
  it('accepts a valid search', () => {
    expect(validateStaySearch(draft(), rules, now)).toEqual([]);
  });

  it('requires both dates', () => {
    expect(validateStaySearch(draft({ checkIn: null, checkOut: null }), rules, now)).toEqual([
      { field: 'checkIn', code: 'required' },
      { field: 'checkOut', code: 'required' },
    ]);
  });

  it('refuses an arrival in the past', () => {
    const errors = validateStaySearch(draft({ checkIn: '2026-10-30' }), rules, now);
    expect(errors).toContainEqual({ field: 'checkIn', code: 'inPast' });
  });

  it('allows a same-day arrival until 23:00 only (RM-06)', () => {
    const tonight = draft({ checkIn: '2026-10-31', checkOut: '2026-11-01' });
    expect(validateStaySearch(tonight, rules, { date: '2026-10-31', minutesOfDay: 1379 })).toEqual(
      [],
    );
    expect(validateStaySearch(tonight, rules, { date: '2026-10-31', minutesOfDay: 1380 })).toEqual([
      { field: 'checkIn', code: 'sameDayClosed' },
    ]);
  });

  it('refuses an arrival more than 365 days ahead (RM-06)', () => {
    const errors = validateStaySearch(
      draft({ checkIn: '2027-11-01', checkOut: '2027-11-03' }),
      rules,
      now,
    );
    expect(errors).toEqual([{ field: 'checkIn', code: 'tooFarAhead' }]);
  });

  it('refuses a departure on or before the arrival', () => {
    const errors = validateStaySearch(draft({ checkOut: '2026-11-12' }), rules, now);
    expect(errors).toEqual([{ field: 'checkOut', code: 'notAfterCheckIn' }]);
  });

  it('accepts 30 nights and refuses 31 (RM-06)', () => {
    expect(validateStaySearch(draft({ checkOut: '2026-12-12' }), rules, now)).toEqual([]);
    expect(validateStaySearch(draft({ checkOut: '2026-12-13' }), rules, now)).toEqual([
      { field: 'checkOut', code: 'stayTooLong' },
    ]);
  });

  it('requires the age of every child', () => {
    const errors = validateStaySearch(
      draft({ rooms: [{ adults: 2, childrenAges: [4, null] }] }),
      rules,
      now,
    );
    expect(errors).toEqual([{ field: 'childAge', roomIndex: 0, childIndex: 1, code: 'required' }]);
  });

  it('refuses more than 4 counted guests in a room, babies under 2 excluded', () => {
    const tooMany = draft({ rooms: [{ adults: 3, childrenAges: [5, 8] }] });
    expect(validateStaySearch(tooMany, rules, now)).toEqual([
      { field: 'room', roomIndex: 0, code: 'tooManyGuests' },
    ]);
    const withBaby = draft({ rooms: [{ adults: 2, childrenAges: [5, 8, 1] }] });
    expect(validateStaySearch(withBaby, rules, now)).toEqual([]);
  });

  it('refuses more than 5 rooms', () => {
    const rooms = Array.from({ length: 6 }, () => ({ adults: 1, childrenAges: [] }));
    expect(validateStaySearch(draft({ rooms }), rules, now)).toContainEqual({
      field: 'rooms',
      code: 'tooManyRooms',
    });
  });
});
