import type { Sequelize, Transaction } from 'sequelize';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import {
  checkTransition,
  INCIDENT_ASSIGN_ROLES,
  type IncidentStatus,
  STATUS_WORDS,
} from '../domain/incident-rules.ts';
import {
  type IncidentEventView,
  type IncidentFilter,
  IncidentRepository,
  type IncidentView,
  type NewIncident,
  type PersonName,
} from '../infrastructure/incident-repository.ts';

export interface ActionOrigin {
  ip: string | undefined;
}

export interface IncidentDetail extends IncidentView {
  events: IncidentEventView[];
}

export interface Assignment {
  assignedTo: string | null;
  externalContractor: string | null;
}

export class IncidentClosedError extends ConflictError {
  constructor() {
    super(
      'INCIDENT_CLOSED',
      'Panne clôturée',
      'Cette panne est clôturée : elle ne peut plus être modifiée.',
    );
  }
}

/**
 * Incidents: report, follow, assign, comment, resolve, close. Each action runs in one
 * transaction with its line in the incident history, its audit log entry and, when the room is
 * unusable, the block or release of the room: if one step fails, nothing is kept.
 */
export class IncidentService {
  readonly #sequelize: Sequelize;
  readonly #repository: IncidentRepository;
  readonly #today: () => string;

  /** `today` gives the current day at the hotel (« YYYY-MM-DD »); the tests fix it. */
  constructor(sequelize: Sequelize, today: () => string) {
    this.#sequelize = sequelize;
    this.#repository = new IncidentRepository(sequelize);
    this.#today = today;
  }

  async #audit(
    actor: StaffUser,
    action: string,
    incidentId: string,
    changes: Record<string, unknown>,
    origin: ActionOrigin,
    transaction: Transaction,
  ): Promise<void> {
    await recordAudit(
      this.#sequelize,
      {
        actorType: 'staff',
        actorUserId: actor.id,
        action,
        entityType: 'incident',
        entityId: incidentId,
        changes,
        ipAddress: origin.ip,
      },
      transaction,
    );
  }

  /** The incident, locked until the end of the transaction; refused once closed. */
  async #openIncident(id: string, transaction: Transaction): Promise<IncidentView> {
    const incident = await this.#repository.find(id, transaction, true);
    if (incident === undefined) {
      throw new NotFoundError('Cette panne n’existe pas.');
    }
    if (incident.status === 'closed') {
      throw new IncidentClosedError();
    }
    return incident;
  }

  list(filter: IncidentFilter): Promise<IncidentView[]> {
    return this.#repository.list(filter);
  }

  technicians(): Promise<PersonName[]> {
    return this.#repository.technicians();
  }

  async detail(id: string): Promise<IncidentDetail> {
    const incident = await this.#repository.find(id);
    if (incident === undefined) {
      throw new NotFoundError('Cette panne n’existe pas.');
    }
    return { ...incident, events: await this.#repository.events(id) };
  }

  async report(
    actor: StaffUser,
    fields: NewIncident,
    origin: ActionOrigin,
  ): Promise<IncidentDetail> {
    const id = await this.#sequelize.transaction(async (transaction) => {
      if (fields.roomId !== null) {
        const active = await this.#repository.isActiveRoom(fields.roomId, transaction);
        if (!active) {
          throw new ValidationError([
            { field: 'roomId', message: 'Chambre inconnue ou désactivée.' },
          ]);
        }
      }
      const incidentId = await this.#repository.insert(fields, actor.id, transaction);
      await this.#repository.addEvent(
        incidentId,
        { type: 'status_change', toStatus: 'reported', actorId: actor.id },
        transaction,
      );
      if (fields.blocksRoom && fields.roomId !== null) {
        await this.#repository.blockRoom(
          incidentId,
          fields.roomId,
          this.#today(),
          actor.id,
          transaction,
        );
      }
      await this.#audit(actor, 'incident.reported', incidentId, { ...fields }, origin, transaction);
      return incidentId;
    });
    return this.detail(id);
  }

  async changeStatus(
    actor: StaffUser,
    id: string,
    status: IncidentStatus,
    comment: string | null,
    origin: ActionOrigin,
  ): Promise<IncidentDetail> {
    await this.#sequelize.transaction(async (transaction) => {
      const incident = await this.#repository.find(id, transaction, true);
      if (incident === undefined) {
        throw new NotFoundError('Cette panne n’existe pas.');
      }
      const check = checkTransition(incident.status, status, actor.role);
      if (check === 'invalid') {
        throw new ConflictError(
          'INCIDENT_TRANSITION_INVALID',
          'Changement impossible',
          `Une panne « ${STATUS_WORDS[incident.status]} » ne peut pas passer ` +
            `« ${STATUS_WORDS[status]} ».`,
        );
      }
      if (check === 'forbidden') {
        throw new ForbiddenError();
      }
      await this.#repository.setStatus(id, status, actor.id, transaction);
      await this.#repository.addEvent(
        id,
        {
          type: 'status_change',
          fromStatus: incident.status,
          toStatus: status,
          comment,
          actorId: actor.id,
        },
        transaction,
      );
      // The room goes back on sale when the incident is resolved, out again if reopened.
      if (incident.blocksRoom && incident.room !== null) {
        if (status === 'resolved') {
          await this.#repository.releaseRoom(id, this.#today(), actor.id, transaction);
        } else if (incident.status === 'resolved' && status === 'in_progress') {
          await this.#repository.blockRoom(
            id,
            incident.room.id,
            this.#today(),
            actor.id,
            transaction,
          );
        }
      }
      await this.#audit(
        actor,
        'incident.status_changed',
        id,
        { status: { from: incident.status, to: status } },
        origin,
        transaction,
      );
    });
    return this.detail(id);
  }

  async assign(
    actor: StaffUser,
    id: string,
    assignment: Assignment,
    origin: ActionOrigin,
  ): Promise<IncidentDetail> {
    if (!INCIDENT_ASSIGN_ROLES.includes(actor.role)) {
      throw new ForbiddenError();
    }
    await this.#sequelize.transaction(async (transaction) => {
      const incident = await this.#openIncident(id, transaction);
      const { assignedTo, externalContractor } = assignment;
      if (
        assignedTo !== null &&
        !(await this.#repository.isActiveTechnician(assignedTo, transaction))
      ) {
        throw new ValidationError([
          { field: 'assignedTo', message: 'Choisissez un technicien actif.' },
        ]);
      }
      await this.#repository.setAssignment(id, assignedTo, externalContractor, transaction);
      await this.#repository.addEvent(id, { type: 'assignment', actorId: actor.id }, transaction);
      await this.#audit(
        actor,
        'incident.assigned',
        id,
        {
          assignedTo: { from: incident.assignedTo?.id ?? null, to: assignedTo },
          externalContractor: { from: incident.externalContractor, to: externalContractor },
        },
        origin,
        transaction,
      );
    });
    return this.detail(id);
  }

  async comment(
    actor: StaffUser,
    id: string,
    comment: string,
    origin: ActionOrigin,
  ): Promise<IncidentDetail> {
    await this.#sequelize.transaction(async (transaction) => {
      await this.#openIncident(id, transaction);
      await this.#repository.addEvent(
        id,
        { type: 'comment', comment, actorId: actor.id },
        transaction,
      );
      await this.#audit(actor, 'incident.commented', id, {}, origin, transaction);
    });
    return this.detail(id);
  }
}
