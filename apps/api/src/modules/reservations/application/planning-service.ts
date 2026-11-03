import type { Sequelize } from 'sequelize';
import { ValidationError } from '../../../shared/domain/errors.ts';
import { addDays } from '../../catalog/domain/pricing.ts';
import type { Role } from '../../identity/domain/identity-rules.ts';
import { planningPeriodErrors, seesGuestNames } from '../domain/planning-rules.ts';
import type { ReservationStatus } from '../domain/reservation-rules.ts';
import {
  type PlanningBlockRow,
  PlanningRepository,
  type PlanningRoomRow,
  type PlanningStayRow,
} from '../infrastructure/planning-repository.ts';

export interface PlanningStay {
  reservationId: string;
  lineId: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  status: ReservationStatus;
  adults: number;
  children: number;
  /** « Martin J. » for management and reception; left out for the other roles. */
  guestName?: string;
}

export interface PlanningBlock {
  from: string;
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
  /** The « To assign » line: stays of the category without a room number yet. */
  unassigned: PlanningStay[];
}

export interface Planning {
  from: string;
  to: string;
  categories: PlanningCategory[];
}

/**
 * The planning of the rooms (« room rack »): for each category, its rooms with their stays and
 * their blocks, and the stays still to assign. Read only; every role.
 */
export class PlanningService {
  readonly #repository: PlanningRepository;

  constructor(sequelize: Sequelize) {
    this.#repository = new PlanningRepository(sequelize);
  }

  async planning(from: string, to: string, role: Role): Promise<Planning> {
    const errors = planningPeriodErrors(from, to);
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
    const end = addDays(to, 1);
    const [categories, rooms, stays, blocks] = await Promise.all([
      this.#repository.categories(),
      this.#repository.rooms(from, end),
      this.#repository.stays(from, end),
      this.#repository.blocks(from, end),
    ]);
    const names = seesGuestNames(role);
    const stayOf = (row: PlanningStayRow): PlanningStay => ({
      reservationId: row.reservationId,
      lineId: row.lineId,
      reference: row.reference,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      status: row.status,
      adults: row.adults,
      children: row.children,
      ...(names ? { guestName: `${row.lastName} ${row.firstName.slice(0, 1)}.` } : {}),
    });
    const blockOf = (row: PlanningBlockRow): PlanningBlock => ({
      from: row.from,
      to: row.to,
      reason: row.reason,
      incident:
        row.incidentId === null || row.incidentReference === null
          ? null
          : { id: row.incidentId, reference: row.incidentReference },
    });

    const roomOf = (room: PlanningRoomRow): PlanningRoom => ({
      id: room.id,
      number: room.number,
      floor: room.floor,
      housekeepingStatus: room.housekeepingStatus,
      isActive: room.isActive,
      stays: stays.filter((stay) => stay.roomId === room.id).map(stayOf),
      blocks: blocks.filter((block) => block.roomId === room.id).map(blockOf),
    });
    const toAssign = (categoryId: string): PlanningStayRow[] => {
      return stays.filter((stay) => stay.categoryId === categoryId && stay.roomId === null);
    };

    const result = categories.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      rooms: rooms.filter((room) => room.categoryId === category.id).map(roomOf),
      unassigned: toAssign(category.id).map(stayOf),
    }));
    // A category without any room to show has nothing to plan.
    return {
      from,
      to,
      categories: result.filter((category) => {
        return category.rooms.length > 0 || category.unassigned.length > 0;
      }),
    };
  }
}
