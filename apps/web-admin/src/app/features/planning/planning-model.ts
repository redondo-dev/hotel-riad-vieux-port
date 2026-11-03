import type { Role } from '../../core/auth/roles';
import type { ReservationStatus } from '../reservations/reservation-model';

/**
 * The planning of the rooms (UI/UX specification, section 5.C): what the API answers, and the
 * pure rules that place the stays and the blocks on the days shown. Dates are « YYYY-MM-DD ».
 */

export interface PlanningStay {
  reservationId: string;
  lineId: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  status: ReservationStatus;
  adults: number;
  children: number;
  /** « Martin J. »; left out by the API for housekeeping and technicians. */
  guestName?: string;
}

export interface PlanningBlock {
  from: string;
  /** Day after the last night out of service; null while the end is unknown. */
  to: string | null;
  reason: string;
  incident: { id: string; reference: string } | null;
}

export interface PlanningRoom {
  id: string;
  number: string;
  floor: number;
  housekeepingStatus: 'clean' | 'dirty';
  isActive: boolean;
  stays: PlanningStay[];
  blocks: PlanningBlock[];
}

export interface PlanningCategory {
  id: string;
  code: string;
  name: string;
  rooms: PlanningRoom[];
  /** Stays of the category without a room yet. */
  unassigned: PlanningStay[];
}

export interface Planning {
  from: string;
  to: string;
  categories: PlanningCategory[];
}

/** Days shown at once, and the step of the arrows. */
export const PLANNING_DAYS = 14;
export const PLANNING_STEP = 7;

const DAY_MS = 86_400_000;

/** « 2034-05-10 » + 3 → « 2034-05-13 ». */
export function addDays(day: string, count: number): string {
  const time = Date.parse(`${day}T00:00:00Z`) + count * DAY_MS;
  return new Date(time).toISOString().slice(0, 10);
}

/** Today at the hotel (Marseille). */
export function hotelToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

export function daysFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

/** Days from `first` to `day`: the nights of a stay from its arrival to its departure. */
export function daysBetween(first: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS);
}

/** Where a period sits on the days shown: its first column (0 for the first day) and length. */
export interface Span {
  start: number;
  length: number;
  /** Begins before the first day shown. */
  before: boolean;
  /** Goes on after the last day shown. */
  after: boolean;
}

/**
 * The nights from `from` (included) to `to` (excluded, null: no end yet) on the `count` days
 * shown from `first`; null when none of them is shown.
 */
export function spanOf(from: string, to: string | null, first: string, count: number): Span | null {
  const begin = daysBetween(first, from);
  const end = to === null ? Number.POSITIVE_INFINITY : daysBetween(first, to);
  const start = Math.max(begin, 0);
  const stop = Math.min(end, count);
  if (stop <= start) {
    return null;
  }
  return { start, length: stop - start, before: begin < 0, after: end > count };
}

/** The stays still to assign, on as few lines as possible, none overlapping another. */
export function lanesOf<T extends { checkIn: string; checkOut: string }>(
  stays: readonly T[],
): T[][] {
  const lanes: T[][] = [];
  const sorted = [...stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  for (const stay of sorted) {
    const lane = lanes.find((items) => (items.at(-1)?.checkOut ?? '') <= stay.checkIn);
    if (lane === undefined) {
      lanes.push([stay]);
    } else {
      lane.push(stay);
    }
  }
  return lanes;
}

/** Whether the guests sleep there the night of `day`. */
export function sleepsOn(stay: Pick<PlanningStay, 'checkIn' | 'checkOut'>, day: string): boolean {
  return stay.checkIn <= day && day < stay.checkOut;
}

/**
 * Stays of a room booked on a night it is out of service (an incident blocked it after the
 * room was given): the guests must be moved. Their line ids.
 */
export function conflictingStays(room: PlanningRoom): Set<string> {
  const lines = new Set<string>();
  for (const stay of room.stays) {
    const blocked = room.blocks.some((block) => {
      return block.from < stay.checkOut && (block.to === null || stay.checkIn < block.to);
    });
    if (blocked && stay.status !== 'checked_out') {
      lines.add(stay.lineId);
    }
  }
  return lines;
}

export type DayEventKind = 'departure' | 'arrival' | 'staying' | 'blocked';

export const EVENT_LABELS: Record<DayEventKind, string> = {
  departure: 'Départ',
  arrival: 'Arrivée',
  staying: 'Occupée',
  blocked: 'Hors service',
};

export type DayEvent =
  | { kind: 'departure' | 'arrival' | 'staying'; stay: PlanningStay }
  | { kind: 'blocked'; block: PlanningBlock };

/** What happens in a room on `day`, in the order of the day: departures first. None: free. */
export function eventsOn(room: PlanningRoom, day: string): DayEvent[] {
  const events: DayEvent[] = [];
  for (const stay of room.stays) {
    if (stay.checkOut === day) {
      events.push({ kind: 'departure', stay });
    }
  }
  for (const block of room.blocks) {
    if (block.from <= day && (block.to === null || day < block.to)) {
      events.push({ kind: 'blocked', block });
    }
  }
  for (const stay of room.stays) {
    if (stay.checkIn === day) {
      events.push({ kind: 'arrival', stay });
    } else if (sleepsOn(stay, day)) {
      events.push({ kind: 'staying', stay });
    }
  }
  return events;
}

/** The reception and the management open the reservations; the others see the rooms only. */
export function opensReservations(role: Role | undefined): boolean {
  return role === 'direction' || role === 'reception';
}

// --- Texts ---

/** « 2 adultes, 1 enfant »: the planning gives the number of children, not their ages. */
export function headcountText(stay: Pick<PlanningStay, 'adults' | 'children'>): string {
  const adults = `${stay.adults} adulte${stay.adults > 1 ? 's' : ''}`;
  if (stay.children === 0) {
    return adults;
  }
  return `${adults}, ${stay.children} enfant${stay.children > 1 ? 's' : ''}`;
}

/** The name for the reception and the management, the headcount for the other roles. */
export function stayLabel(stay: PlanningStay): string {
  return stay.guestName ?? `${stay.adults + stay.children} pers.`;
}

/** « lun. » and « 3 », for the head of a column. */
export function dayHead(day: string): { weekday: string; number: string } {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' });
  return { weekday, number: String(date.getUTCDate()) };
}

/** « lundi 3 novembre ». */
export function dayTitle(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Colours of a stay by its status, as on the reservation badges. */
export function stayTone(status: ReservationStatus): string {
  switch (status) {
    case 'pending_payment':
      return 'border-warning/40 bg-warning-pale text-warning';
    case 'checked_in':
      return 'border-success/40 bg-success-pale text-success';
    case 'checked_out':
      return 'border-line bg-mist text-muted';
    default:
      return 'border-port/30 bg-info-pale text-port';
  }
}
