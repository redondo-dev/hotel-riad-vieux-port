import { describe, expect, it } from 'vitest';
import {
  freeCancellationUntil,
  hotelInstant,
  newReference,
  nightLabel,
  REFERENCE_ALPHABET,
  serviceQuantity,
} from './reservation-rules.ts';

describe('newReference', () => {
  it('draws 8 characters easy to read, never 0, O, 1 or I', () => {
    let draw = 0;
    const reference = newReference((size) => (draw++ * 7) % size);
    expect(reference).toMatch(/^[A-Z2-9]{8}$/);
    expect([...reference].every((letter) => REFERENCE_ALPHABET.includes(letter))).toBe(true);
    expect(REFERENCE_ALPHABET).not.toMatch(/[01IO]/);
  });
});

describe('hotelInstant', () => {
  it('reads the time of Marseille, in winter and in summer', () => {
    expect(hotelInstant('2034-01-10', '15:00:00').toISOString()).toBe('2034-01-10T14:00:00.000Z');
    expect(hotelInstant('2034-07-10', '15:00:00').toISOString()).toBe('2034-07-10T13:00:00.000Z');
  });

  it('stays right on the days the time changes', () => {
    // 26 March 2034: summer time from 02:00; 29 October 2034: winter time from 03:00.
    expect(hotelInstant('2034-03-26', '15:00').toISOString()).toBe('2034-03-26T13:00:00.000Z');
    expect(hotelInstant('2034-10-29', '15:00').toISOString()).toBe('2034-10-29T14:00:00.000Z');
  });
});

describe('freeCancellationUntil (RM-15, RM-16)', () => {
  it('ends 48 hours before the arrival time, for the flexible rate only', () => {
    const stay = { checkIn: '2034-07-10', checkInTime: '15:00:00', freeCancellationHours: 48 };
    const flexible = freeCancellationUntil({ ...stay, ratePlan: 'flexible' });
    expect(flexible?.toISOString()).toBe('2034-07-08T13:00:00.000Z');
    expect(freeCancellationUntil({ ...stay, ratePlan: 'non_refundable' })).toBeNull();
  });
});

describe('serviceQuantity', () => {
  const stay = { guests: 3, nights: 2, units: 4 };

  it('counts breakfast per guest and per night (RM-12)', () => {
    expect(serviceQuantity('per_person_night', stay)).toBe(6);
  });

  it('counts the other units', () => {
    expect(serviceQuantity('per_night', stay)).toBe(2);
    expect(serviceQuantity('per_stay', stay)).toBe(1);
    expect(serviceQuantity('per_unit', stay)).toBe(4);
  });
});

describe('nightLabel', () => {
  it('names the rate period applied to a night', () => {
    expect(nightLabel(0)).toBeNull();
    expect(nightLabel(30)).toBe('+30 %');
    expect(nightLabel(-12.5)).toBe('−12,5 %');
  });
});
