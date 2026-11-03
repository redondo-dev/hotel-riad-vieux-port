import { describe, expect, it } from 'vitest';
import { parseGuests, stayDateErrors } from './stay-rules.ts';

const TODAY = '2034-03-10';

function fields(checkIn: string, checkOut: string): string[] {
  return stayDateErrors(checkIn, checkOut, TODAY).map((error) => error.field);
}

describe('stayDateErrors (RM-04)', () => {
  it('accepts an arrival today and a departure the next day', () => {
    expect(fields(TODAY, '2034-03-11')).toEqual([]);
  });

  it('refuses an arrival in the past and a departure not after the arrival', () => {
    expect(fields('2034-03-09', '2034-03-11')).toEqual(['checkIn']);
    expect(fields('2034-03-12', '2034-03-12')).toEqual(['checkOut']);
  });

  it('allows the reception more than the 30 online nights, within technical bounds', () => {
    expect(fields('2034-04-01', '2034-05-31')).toEqual([]);
    expect(fields('2034-04-01', '2034-07-01')).toEqual(['checkOut']);
    expect(fields('2036-03-11', '2036-03-12')).toEqual(['checkIn']);
  });
});

describe('parseGuests', () => {
  it('reads one block per room: adults, then the ages of the children', () => {
    expect(parseGuests('2-6-3_2')).toEqual([
      { adults: 2, childrenAges: [6, 3] },
      { adults: 2, childrenAges: [] },
    ]);
  });

  it('refuses a wrong format or a value out of bounds', () => {
    expect(typeof parseGuests('deux')).toBe('string');
    expect(typeof parseGuests('2--3')).toBe('string');
    expect(typeof parseGuests('0')).toBe('string');
    expect(typeof parseGuests('5')).toBe('string');
    expect(typeof parseGuests('2-18')).toBe('string');
    expect(typeof parseGuests('2-1-2-3-4')).toBe('string');
    expect(typeof parseGuests('1_1_1_1_1_1')).toBe('string');
  });
});
