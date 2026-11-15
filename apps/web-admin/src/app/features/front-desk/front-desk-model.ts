import type { RatePlan, ReservationStatus } from '../reservations/reservation-model';

/**
 * The « Today » screen of the reception (UI/UX specification, section 5.H): what the API gives
 * (GET /admin/front-desk) and the pure rules of the screen. The API checks the same rules.
 */

export interface FrontDeskRoomState {
  id: string;
  number: string;
  housekeepingStatus: 'clean' | 'dirty';
  outOfService: boolean;
}

export interface FrontDeskRoom {
  lineId: string;
  categoryName: string;
  room: FrontDeskRoomState | null;
}

export interface FrontDeskItem {
  id: string;
  reference: string;
  status: ReservationStatus;
  version: number;
  ratePlan: RatePlan;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalCents: number;
  /** « Martin Camille ». */
  customerName: string;
  adults: number;
  children: number;
  customerMessage: string | null;
  rooms: FrontDeskRoom[];
  /** Expected before the day shown: late arrival, or departure forgotten. */
  late: boolean;
}

export interface FrontDeskList {
  total: number;
  done: number;
  items: FrontDeskItem[];
}

export interface FrontDeskDay {
  date: string;
  arrivals: FrontDeskList;
  departures: FrontDeskList;
}

export type FrontDeskAction = 'check-in' | 'check-out' | 'no-show';

export const ACTION_LABELS: Record<FrontDeskAction, string> = {
  'check-in': 'Enregistrer l’arrivée',
  'check-out': 'Enregistrer le départ',
  'no-show': 'Déclarer non présenté',
};

type StayState = Pick<FrontDeskItem, 'status' | 'checkIn' | 'checkOut'>;

/**
 * What may be done on a stay `today`: the arrival from the arrival day to the day before the
 * departure, the no-show from the day after the arrival, the departure from the departure day.
 */
export function actionsFor(stay: StayState, today: string): FrontDeskAction[] {
  const actions: FrontDeskAction[] = [];
  if (stay.status === 'confirmed') {
    if (stay.checkIn <= today && today < stay.checkOut) {
      actions.push('check-in');
    }
    if (today > stay.checkIn) {
      actions.push('no-show');
    }
  }
  if (stay.status === 'checked_in' && today >= stay.checkOut) {
    actions.push('check-out');
  }
  return actions;
}

/** What stops or warns at the arrival: rooms to give, out of service, to be cleaned. */
export interface RoomCheck {
  missing: number;
  outOfService: string[];
  dirty: string[];
}

export function roomCheck(rooms: readonly FrontDeskRoom[]): RoomCheck {
  const given = rooms.map((line) => line.room).filter((room) => room !== null);
  return {
    missing: rooms.length - given.length,
    outOfService: given.filter((room) => room.outOfService).map((room) => room.number),
    dirty: given.filter((room) => room.housekeepingStatus === 'dirty').map((room) => room.number),
  };
}

/** « 12, dont 4 faites ». */
export function countText(list: Pick<FrontDeskList, 'total' | 'done'>): string {
  return `${list.total}, dont ${list.done} ${list.done > 1 ? 'faites' : 'faite'}`;
}

/** « Double standard · 112 », « Chambre familiale · à attribuer ». */
export function roomLineText(line: FrontDeskRoom): string {
  return `${line.categoryName} · ${line.room?.number ?? 'à attribuer'}`;
}

/** « La chambre 112 est à nettoyer », « Les chambres 112, 204 sont à nettoyer ». */
export function dirtyText(numbers: readonly string[]): string {
  return numbers.length === 1
    ? `La chambre ${numbers.join('')} est à nettoyer`
    : `Les chambres ${numbers.join(', ')} sont à nettoyer`;
}

/** What a no-show costs (RM-17); the exact amount comes back from the API. */
export function noShowFeeText(ratePlan: RatePlan): string {
  return ratePlan === 'non_refundable'
    ? 'Tarif non remboursable : toutes les nuits restent dues.'
    : 'Tarif flexible : la première nuit de chaque chambre est due.';
}

/** The tiles of the day (step T-3): rooms still to give to the arrivals, and stays late. */
export interface DayFigures {
  unassigned: number;
  lateArrivals: number;
  lateDepartures: number;
}

export function dayFiguresOf(day: Pick<FrontDeskDay, 'arrivals' | 'departures'>): DayFigures {
  const waiting = day.arrivals.items.filter((item) => item.status === 'confirmed');
  return {
    unassigned: waiting.reduce(
      (count, item) => count + item.rooms.filter((line) => line.room === null).length,
      0,
    ),
    lateArrivals: day.arrivals.items.filter((item) => item.late).length,
    lateDepartures: day.departures.items.filter((item) => item.late).length,
  };
}

/** « 3 faites », « aucune faite ». */
export function doneNote(done: number, feminine: boolean): string {
  const word = feminine ? 'faite' : 'fait';
  if (done === 0) {
    return feminine ? 'aucune faite' : 'aucun fait';
  }
  return `${done} ${word}${done > 1 ? 's' : ''}`;
}
