import { describe, expect, it } from 'vitest';
import {
  type CandidateCategory,
  hotelClock,
  onlineStayErrors,
  publicOffers,
} from './public-offer-rules.ts';

const RULES = { maxStayNights: 30, bookingHorizonDays: 365, sameDayCutoffMinutes: 23 * 60 };
const NOON = { date: '2034-04-01', minutesOfDay: 12 * 60 };

function fields(checkIn: string, checkOut: string, clock = NOON): string[] {
  return onlineStayErrors(checkIn, checkOut, clock, RULES).map((error) => error.field);
}

describe('hotelClock', () => {
  it('reads the day and the time in Marseille, summer and winter', () => {
    // 21:30 UTC is 23:30 in summer (UTC+2) and 22:30 in winter (UTC+1).
    expect(hotelClock(new Date('2034-07-01T21:30:00Z'))).toEqual({
      date: '2034-07-01',
      minutesOfDay: 23 * 60 + 30,
    });
    expect(hotelClock(new Date('2034-01-10T23:15:00Z'))).toEqual({
      date: '2034-01-11',
      minutesOfDay: 15,
    });
  });
});

describe('onlineStayErrors (RM-06)', () => {
  it('accepts a stay inside the online limits', () => {
    expect(fields('2034-04-01', '2034-04-03')).toEqual([]);
    expect(fields('2035-04-01', '2035-05-01')).toEqual([]);
  });

  it('refuses the past, too far ahead, too long and a reversed stay', () => {
    expect(fields('2034-03-31', '2034-04-02')).toEqual(['checkIn']);
    expect(fields('2035-04-02', '2035-04-03')).toEqual(['checkIn']);
    expect(fields('2034-04-10', '2034-05-11')).toEqual(['checkOut']);
    expect(fields('2034-04-10', '2034-04-10')).toEqual(['checkOut']);
  });

  it('closes the same evening at the cutoff time, with a message saying until when', () => {
    const late = { date: '2034-04-01', minutesOfDay: 23 * 60 };
    const justBefore = { date: '2034-04-01', minutesOfDay: 23 * 60 - 1 };
    expect(fields('2034-04-01', '2034-04-02', justBefore)).toEqual([]);
    const errors = onlineStayErrors('2034-04-01', '2034-04-02', late, RULES);
    expect(errors).toEqual([
      {
        field: 'checkIn',
        message: 'Arrivée ce soir : réservation en ligne possible jusqu’à 23 h, appelez l’hôtel.',
      },
    ]);
    // The next day is not concerned.
    expect(fields('2034-04-02', '2034-04-03', late)).toEqual([]);
  });
});

function candidate(changes: Partial<CandidateCategory> = {}): CandidateCategory {
  const offer = { fits: true, flexibleCents: 20_000, nonRefundableCents: 18_000 } as const;
  return {
    code: 'double',
    freeRooms: 10,
    closed: false,
    offers: [
      { ...offer, touristTaxCents: 1000 },
      { ...offer, touristTaxCents: 500 },
    ],
    ...changes,
  };
}

describe('publicOffers', () => {
  it('adds up the requested rooms and hides a comfortable stock', () => {
    expect(publicOffers([candidate()])).toEqual([
      {
        code: 'double',
        roomsLeft: null,
        flexibleCents: 40_000,
        nonRefundableCents: 36_000,
        touristTaxCents: 1500,
      },
    ]);
  });

  it('tells the stock when 3 rooms or fewer are left', () => {
    expect(publicOffers([candidate({ freeRooms: 3 })])[0]?.roomsLeft).toBe(3);
    expect(publicOffers([candidate({ freeRooms: 4 })])[0]?.roomsLeft).toBeNull();
  });

  it('leaves out a category closed, too small for one room, or without enough rooms', () => {
    const tooSmall = candidate({ offers: [...candidate().offers.slice(0, 1), { fits: false }] });
    expect(publicOffers([candidate({ closed: true })])).toEqual([]);
    expect(publicOffers([tooSmall])).toEqual([]);
    expect(publicOffers([candidate({ freeRooms: 1 })])).toEqual([]);
    expect(publicOffers([candidate({ offers: [] })])).toEqual([]);
  });
});
