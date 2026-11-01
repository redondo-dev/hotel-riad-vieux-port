import type { Role } from '../../core/auth/roles';

/**
 * Housekeeping as the API gives it (GET /admin/housekeeping/rooms) and the pure rules of the
 * screen. Same rights as the API: hiding a button is a comfort, never a protection.
 */

export type HousekeepingStatus = 'clean' | 'dirty';

export interface HousekeepingRoom {
  id: string;
  number: string;
  floor: number;
  categoryCode: string;
  categoryName: string;
  status: HousekeepingStatus;
}

export const STATUS_LABELS: Record<HousekeepingStatus, string> = {
  clean: 'Propre',
  dirty: 'À nettoyer',
};

/** Housekeeping and management set both states; the reception only « to be cleaned ». */
export function canSetStatus(role: Role | undefined, status: HousekeepingStatus): boolean {
  if (role === 'direction' || role === 'housekeeping') {
    return true;
  }
  return role === 'reception' && status === 'dirty';
}

/** State a tap on the room gives, or null when this role cannot change it. */
export function nextStatus(
  room: HousekeepingRoom,
  role: Role | undefined,
): HousekeepingStatus | null {
  const next: HousekeepingStatus = room.status === 'clean' ? 'dirty' : 'clean';
  return canSetStatus(role, next) ? next : null;
}

export interface FloorGroup {
  floor: number;
  rooms: HousekeepingRoom[];
  /** Rooms of the floor still to be cleaned (all of them, whatever the filter). */
  dirty: number;
}

export interface BoardFilter {
  /** true: only the rooms to be cleaned. */
  toDoOnly: boolean;
  /** null: every floor. */
  floor: number | null;
}

/** Rooms grouped by floor, in order; floors with nothing to show are left out. */
export function floorsOf(rooms: readonly HousekeepingRoom[], filter: BoardFilter): FloorGroup[] {
  const groups = new Map<number, FloorGroup>();
  const sorted = [...rooms].sort((a, b) => {
    return a.floor - b.floor || a.number.localeCompare(b.number, 'fr', { numeric: true });
  });
  for (const room of sorted) {
    if (filter.floor !== null && room.floor !== filter.floor) {
      continue;
    }
    let group = groups.get(room.floor);
    if (group === undefined) {
      group = { floor: room.floor, rooms: [], dirty: 0 };
      groups.set(room.floor, group);
    }
    if (room.status === 'dirty') {
      group.dirty += 1;
    }
    if (!filter.toDoOnly || room.status === 'dirty') {
      group.rooms.push(room);
    }
  }
  return [...groups.values()].filter((group) => group.rooms.length > 0);
}

/** « Reste 3 chambres à nettoyer », « Reste 1 chambre à nettoyer », « Tout est propre ». */
export function remainingText(rooms: readonly HousekeepingRoom[]): string {
  const dirty = rooms.filter((room) => room.status === 'dirty').length;
  if (dirty === 0) {
    return 'Tout est propre';
  }
  return dirty === 1 ? 'Reste 1 chambre à nettoyer' : `Reste ${dirty} chambres à nettoyer`;
}

/** Name of a floor as said in the hotel: « Rez-de-chaussée », « 1er étage », « 2e étage ». */
export function floorLabel(floor: number): string {
  if (floor === 0) {
    return 'Rez-de-chaussée';
  }
  if (floor < 0) {
    return `Sous-sol ${-floor}`;
  }
  return floor === 1 ? '1er étage' : `${floor}e étage`;
}
