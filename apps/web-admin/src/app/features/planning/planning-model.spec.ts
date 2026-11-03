import { describe, expect, it } from 'vitest';
import {
  addDays,
  conflictingStays,
  eventsOn,
  hotelToday,
  lanesOf,
  type PlanningRoom,
  type PlanningStay,
  spanOf,
  stayLabel,
} from './planning-model';

function stay(
  checkIn: string,
  checkOut: string,
  changes: Partial<PlanningStay> = {},
): PlanningStay {
  return {
    reservationId: 'r',
    lineId: `${checkIn}-${checkOut}`,
    reference: 'ABCD2345',
    checkIn,
    checkOut,
    status: 'confirmed',
    adults: 2,
    children: 1,
    ...changes,
  };
}

describe('days', () => {
  it('counts the days across a month and the day of the hotel', () => {
    expect(addDays('2034-05-30', 3)).toBe('2034-06-02');
    expect(addDays('2034-05-01', -1)).toBe('2034-04-30');
    // 23:30 in London is already the next day in Marseille.
    expect(hotelToday(new Date('2034-05-10T22:30:00Z'))).toBe('2034-05-11');
  });
});

describe('spanOf', () => {
  it('places the nights of a stay on the days shown', () => {
    expect(spanOf('2034-05-03', '2034-05-05', '2034-05-01', 14)).toEqual({
      start: 2,
      length: 2,
      before: false,
      after: false,
    });
    expect(spanOf('2034-04-28', '2034-05-02', '2034-05-01', 14)).toMatchObject({
      start: 0,
      length: 1,
      before: true,
    });
  });

  it('runs an open block to the last day, and leaves out what is not shown', () => {
    expect(spanOf('2034-05-10', null, '2034-05-01', 14)).toMatchObject({ start: 9, length: 5 });
    expect(spanOf('2034-04-20', '2034-05-01', '2034-05-01', 14)).toBeNull();
    expect(spanOf('2034-05-15', '2034-05-16', '2034-05-01', 14)).toBeNull();
  });
});

describe('lanesOf', () => {
  it('puts the stays to assign on as few lines as possible', () => {
    const first = stay('2034-05-01', '2034-05-03');
    const second = stay('2034-05-02', '2034-05-04');
    const third = stay('2034-05-03', '2034-05-05');
    expect(lanesOf([third, second, first])).toEqual([[first, third], [second]]);
  });
});

describe('eventsOn', () => {
  it('tells the departure, the arrival and the nights of a room', () => {
    const room: PlanningRoom = {
      id: 'm',
      number: '112',
      floor: 1,
      housekeepingStatus: 'clean',
      isActive: true,
      stays: [stay('2034-05-01', '2034-05-03'), stay('2034-05-03', '2034-05-06')],
      blocks: [],
    };
    const kinds = (day: string): string[] => eventsOn(room, day).map((event) => event.kind);
    expect(kinds('2034-05-02')).toEqual(['staying']);
    expect(kinds('2034-05-03')).toEqual(['departure', 'arrival']);
    expect(kinds('2034-05-06')).toEqual(['departure']);
    expect(kinds('2034-05-07')).toEqual([]);
  });
});

describe('conflictingStays', () => {
  it('finds the stays booked on a night the room is out of service', () => {
    const room: PlanningRoom = {
      id: 'm',
      number: '204',
      floor: 2,
      housekeepingStatus: 'clean',
      isActive: true,
      stays: [stay('2034-05-01', '2034-05-03'), stay('2034-05-05', '2034-05-08')],
      blocks: [{ from: '2034-05-03', to: '2034-05-06', reason: 'incident', incident: null }],
    };
    expect([...conflictingStays(room)]).toEqual(['2034-05-05-2034-05-08']);
  });
});

describe('stayLabel', () => {
  it('shows the name when the API gives it, the headcount otherwise', () => {
    expect(stayLabel(stay('2034-05-01', '2034-05-03', { guestName: 'Martin J.' }))).toBe(
      'Martin J.',
    );
    expect(stayLabel(stay('2034-05-01', '2034-05-03'))).toBe('3 pers.');
  });
});
