import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  countText,
  dayFiguresOf,
  dirtyText,
  doneNote,
  type FrontDeskItem,
  type FrontDeskRoom,
  type FrontDeskRoomState,
  roomCheck,
  roomLineText,
} from './front-desk-model';

const STAY = { status: 'confirmed' as const, checkIn: '2034-05-10', checkOut: '2034-05-12' };

function line(number: string | null, changes: Partial<FrontDeskRoomState> = {}): FrontDeskRoom {
  return {
    lineId: `l-${number ?? 'none'}`,
    categoryName: 'Double standard',
    room:
      number === null
        ? null
        : { id: number, number, housekeepingStatus: 'clean', outOfService: false, ...changes },
  };
}

describe('actionsFor', () => {
  it('offers the arrival from the arrival day, the no-show from the day after', () => {
    expect(actionsFor(STAY, '2034-05-09')).toEqual([]);
    expect(actionsFor(STAY, '2034-05-10')).toEqual(['check-in']);
    expect(actionsFor(STAY, '2034-05-11')).toEqual(['check-in', 'no-show']);
    expect(actionsFor(STAY, '2034-05-12')).toEqual(['no-show']);
  });

  it('offers the departure from the departure day', () => {
    const staying = { ...STAY, status: 'checked_in' as const };
    expect(actionsFor(staying, '2034-05-11')).toEqual([]);
    expect(actionsFor(staying, '2034-05-12')).toEqual(['check-out']);
    expect(actionsFor({ ...STAY, status: 'checked_out' }, '2034-05-12')).toEqual([]);
  });
});

describe('roomCheck', () => {
  it('finds the rooms to give, out of service and to be cleaned', () => {
    const rooms = [
      line('112', { housekeepingStatus: 'dirty' }),
      line('204', { outOfService: true }),
      line(null),
    ];
    expect(roomCheck(rooms)).toEqual({ missing: 1, outOfService: ['204'], dirty: ['112'] });
  });
});

describe('texts', () => {
  it('writes the counters, the rooms and the warning', () => {
    expect(countText({ total: 12, done: 4 })).toBe('12, dont 4 faites');
    expect(countText({ total: 3, done: 1 })).toBe('3, dont 1 faite');
    expect(roomLineText(line(null))).toBe('Double standard · à attribuer');
    expect(dirtyText(['112'])).toBe('La chambre 112 est à nettoyer');
    expect(dirtyText(['112', '204'])).toBe('Les chambres 112, 204 sont à nettoyer');
  });
});

describe('tiles of the day', () => {
  function stay(changes: Partial<FrontDeskItem>): FrontDeskItem {
    return {
      id: 'r',
      reference: 'ABCD2345',
      status: 'confirmed',
      version: 1,
      ratePlan: 'flexible',
      checkIn: '2034-05-10',
      checkOut: '2034-05-12',
      nights: 2,
      totalCents: 21_000,
      customerName: 'Martin Camille',
      adults: 2,
      children: 0,
      customerMessage: null,
      rooms: [line('112')],
      late: false,
      ...changes,
    };
  }

  it('counts the rooms still to give and the stays late', () => {
    const arrivals = [
      stay({ rooms: [line(null), line(null)] }),
      stay({ status: 'checked_in', rooms: [line(null)] }),
      stay({ late: true }),
    ];
    const departures = [stay({ status: 'checked_in', late: true }), stay({ late: false })];
    const day = {
      arrivals: { total: 3, done: 1, items: arrivals },
      departures: { total: 2, done: 0, items: departures },
    };
    expect(dayFiguresOf(day)).toEqual({ unassigned: 2, lateArrivals: 1, lateDepartures: 1 });
  });

  it('says how many are done', () => {
    expect(doneNote(0, true)).toBe('aucune faite');
    expect(doneNote(3, true)).toBe('3 faites');
    expect(doneNote(1, false)).toBe('1 fait');
  });

  it('adds the stays late, kept apart from the count of the day', () => {
    expect(doneNote(0, true, 11)).toBe('aucune faite · 11 en retard');
    expect(doneNote(2, false, 1)).toBe('2 faits · 1 en retard');
    expect(doneNote(2, false, 0)).toBe('2 faits');
  });
});
