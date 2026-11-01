import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { IncidentPriority, IncidentStatus } from '../domain/incident-rules.ts';

/**
 * Incidents, their history and the room blocks they cause, in plain SQL with bound parameters.
 */

export interface PersonName {
  id: string;
  firstName: string;
  lastName: string;
}

export interface IncidentView {
  id: string;
  reference: string;
  room: { id: string; number: string } | null;
  location: string | null;
  title: string;
  description: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  /** « Room unusable » was ticked when reporting. */
  blocksRoom: boolean;
  /** The room is out of sale right now because of this incident. */
  roomBlocked: boolean;
  reportedAt: Date;
  reportedBy: PersonName;
  assignedTo: PersonName | null;
  externalContractor: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

export interface IncidentEventView {
  id: string;
  type: 'status_change' | 'assignment' | 'comment';
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  comment: string | null;
  actor: PersonName | null;
  createdAt: Date;
}

export interface IncidentFilter {
  status?: IncidentStatus | undefined;
  includeClosed: boolean;
  priority?: IncidentPriority | undefined;
  roomId?: string | undefined;
  assignedTo?: string | undefined;
}

export interface NewIncident {
  roomId: string | null;
  location: string | null;
  title: string;
  description: string;
  priority: IncidentPriority;
  blocksRoom: boolean;
}

export interface NewEvent {
  type: IncidentEventView['type'];
  fromStatus?: IncidentStatus | null;
  toStatus?: IncidentStatus | null;
  comment?: string | null;
  actorId: string;
}

interface IncidentRow {
  id: string;
  reference: string;
  roomId: string | null;
  roomNumber: string | null;
  location: string | null;
  title: string;
  description: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  blocksRoom: boolean;
  roomBlocked: boolean;
  reportedAt: Date;
  reporterId: string;
  reporterFirstName: string;
  reporterLastName: string;
  assigneeId: string | null;
  assigneeFirstName: string | null;
  assigneeLastName: string | null;
  externalContractor: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

interface EventRow {
  id: string;
  type: IncidentEventView['type'];
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  comment: string | null;
  actorId: string | null;
  actorFirstName: string | null;
  actorLastName: string | null;
  createdAt: Date;
}

const INCIDENT_SELECT = `
  SELECT i.id, i.reference, i.room_id AS "roomId", r.number AS "roomNumber", i.location,
         i.title, i.description, i.priority, i.status, i.blocks_room AS "blocksRoom",
         EXISTS (SELECT 1 FROM room_blocks b
                  WHERE b.incident_id = i.id AND b.released_at IS NULL) AS "roomBlocked",
         i.reported_at AS "reportedAt",
         rep.id AS "reporterId", rep.first_name AS "reporterFirstName",
         rep.last_name AS "reporterLastName",
         asg.id AS "assigneeId", asg.first_name AS "assigneeFirstName",
         asg.last_name AS "assigneeLastName",
         i.external_contractor AS "externalContractor",
         i.resolved_at AS "resolvedAt", i.closed_at AS "closedAt"
    FROM incidents i
    LEFT JOIN rooms r ON r.id = i.room_id
    JOIN users rep ON rep.id = i.reported_by
    LEFT JOIN users asg ON asg.id = i.assigned_to`;

/** Urgent first, then normal, then low; the most recent first inside each priority. */
const INCIDENT_ORDER = `
  ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           i.reported_at DESC`;

/** At most this many incidents in one list. */
export const INCIDENT_LIST_LIMIT = 200;

function person(
  id: string | null,
  firstName: string | null,
  lastName: string | null,
): PersonName | null {
  return id === null || firstName === null || lastName === null
    ? null
    : { id, firstName, lastName };
}

function toIncident(row: IncidentRow): IncidentView {
  return {
    id: row.id,
    reference: row.reference,
    room:
      row.roomId === null || row.roomNumber === null
        ? null
        : { id: row.roomId, number: row.roomNumber },
    location: row.location,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    blocksRoom: row.blocksRoom,
    roomBlocked: row.roomBlocked,
    reportedAt: row.reportedAt,
    reportedBy: {
      id: row.reporterId,
      firstName: row.reporterFirstName,
      lastName: row.reporterLastName,
    },
    assignedTo: person(row.assigneeId, row.assigneeFirstName, row.assigneeLastName),
    externalContractor: row.externalContractor,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
  };
}

function toEvent(row: EventRow): IncidentEventView {
  return {
    id: row.id,
    type: row.type,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    comment: row.comment,
    actor: person(row.actorId, row.actorFirstName, row.actorLastName),
    createdAt: row.createdAt,
  };
}

export class IncidentRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  async #select<T extends object>(
    sql: string,
    bind: unknown[],
    transaction?: Transaction,
  ): Promise<T[]> {
    return this.#sequelize.query<T>(sql, {
      bind,
      type: QueryTypes.SELECT,
      ...(transaction === undefined ? {} : { transaction }),
    });
  }

  async #execute(sql: string, bind: unknown[], transaction: Transaction): Promise<void> {
    await this.#sequelize.query(sql, { bind, transaction });
  }

  async list(filter: IncidentFilter): Promise<IncidentView[]> {
    // Every filter is optional: a missing one is passed as NULL and matches every row.
    const rows = await this.#select<IncidentRow>(
      `${INCIDENT_SELECT}
        WHERE ($1::text IS NULL OR i.status = $1::text)
          AND ($2::boolean OR i.status <> 'closed')
          AND ($3::text IS NULL OR i.priority = $3::text)
          AND ($4::uuid IS NULL OR i.room_id = $4::uuid)
          AND ($5::uuid IS NULL OR i.assigned_to = $5::uuid)
        ${INCIDENT_ORDER}
        LIMIT ${INCIDENT_LIST_LIMIT}`,
      [
        filter.status ?? null,
        filter.includeClosed || filter.status === 'closed',
        filter.priority ?? null,
        filter.roomId ?? null,
        filter.assignedTo ?? null,
      ],
    );
    return rows.map(toIncident);
  }

  async find(
    id: string,
    transaction?: Transaction,
    lock = false,
  ): Promise<IncidentView | undefined> {
    const rows = await this.#select<IncidentRow>(
      `${INCIDENT_SELECT} WHERE i.id = $1${lock ? ' FOR UPDATE OF i' : ''}`,
      [id],
      transaction,
    );
    const row = rows[0];
    return row === undefined ? undefined : toIncident(row);
  }

  async events(incidentId: string): Promise<IncidentEventView[]> {
    const rows = await this.#select<EventRow>(
      `SELECT e.id::text AS id, e.event_type AS type, e.from_status AS "fromStatus",
              e.to_status AS "toStatus", e.comment, e.created_at AS "createdAt",
              u.id AS "actorId", u.first_name AS "actorFirstName", u.last_name AS "actorLastName"
         FROM incident_events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.incident_id = $1
        ORDER BY e.created_at, e.id`,
      [incidentId],
    );
    return rows.map(toEvent);
  }

  /** An active room of the hotel, if `roomId` names one. */
  async isActiveRoom(roomId: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.#select<{ found: boolean }>(
      'SELECT true AS found FROM rooms WHERE id = $1 AND is_active',
      [roomId],
      transaction,
    );
    return rows.length > 0;
  }

  /** An active technician, if `userId` names one. */
  async isActiveTechnician(userId: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.#select<{ found: boolean }>(
      "SELECT true AS found FROM users WHERE id = $1 AND is_active AND role = 'technician'",
      [userId],
      transaction,
    );
    return rows.length > 0;
  }

  /** Active technicians, for the assignment list. */
  technicians(): Promise<PersonName[]> {
    return this.#select<PersonName>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName"
         FROM users
        WHERE is_active AND role = 'technician'
        ORDER BY last_name, first_name`,
      [],
    );
  }

  async insert(fields: NewIncident, reportedBy: string, transaction: Transaction): Promise<string> {
    const rows = await this.#select<{ id: string }>(
      `INSERT INTO incidents (room_id, location, title, description, priority, blocks_room,
                              reported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        fields.roomId,
        fields.location,
        fields.title,
        fields.description,
        fields.priority,
        fields.blocksRoom,
        reportedBy,
      ],
      transaction,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('panne non enregistrée');
    }
    return id;
  }

  async addEvent(incidentId: string, event: NewEvent, transaction: Transaction): Promise<void> {
    await this.#execute(
      `INSERT INTO incident_events (incident_id, event_type, from_status, to_status, comment,
                                    actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        incidentId,
        event.type,
        event.fromStatus ?? null,
        event.toStatus ?? null,
        event.comment ?? null,
        event.actorId,
      ],
      transaction,
    );
  }

  /**
   * Sets the state and its dates: resolved_at when resolved (cleared when reopened),
   * closed_at and closed_by when closed.
   */
  async setStatus(
    id: string,
    status: IncidentStatus,
    actorId: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE incidents
          SET status = $2::text,
              resolved_at = CASE WHEN $2::text = 'resolved' THEN now()
                                 WHEN $2::text = 'closed' THEN resolved_at
                                 ELSE NULL END,
              closed_at = CASE WHEN $2::text = 'closed' THEN now() ELSE NULL END,
              closed_by = CASE WHEN $2::text = 'closed' THEN $3::uuid ELSE NULL END
        WHERE id = $1`,
      [id, status, actorId],
      transaction,
    );
  }

  async setAssignment(
    id: string,
    assignedTo: string | null,
    externalContractor: string | null,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      'UPDATE incidents SET assigned_to = $2, external_contractor = $3 WHERE id = $1',
      [id, assignedTo, externalContractor],
      transaction,
    );
  }

  /** Takes the room out of sale from `firstNight`, until released. */
  async blockRoom(
    incidentId: string,
    roomId: string,
    firstNight: string,
    actorId: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `INSERT INTO room_blocks (room_id, period, reason, incident_id, created_by)
       VALUES ($1, daterange($2::date, NULL, '[)'), 'incident', $3, $4)`,
      [roomId, firstNight, incidentId, actorId],
      transaction,
    );
  }

  /**
   * Puts the room back on sale: the block ends on `day` (the night of `day` is free again), or
   * the day after it started if it started that very day.
   */
  async releaseRoom(
    incidentId: string,
    day: string,
    actorId: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.#execute(
      `UPDATE room_blocks
          SET period = daterange(lower(period), greatest($2::date, lower(period) + 1), '[)'),
              released_at = now(),
              released_by = $3
        WHERE incident_id = $1 AND released_at IS NULL`,
      [incidentId, day, actorId],
      transaction,
    );
  }
}
