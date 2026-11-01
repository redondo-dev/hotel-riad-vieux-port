import type { Sequelize } from 'sequelize';
import { AppError, NotFoundError } from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import type { StaffUser } from '../../identity/domain/identity-rules.ts';
import { canSetStatus, type HousekeepingStatus } from '../domain/housekeeping-rules.ts';
import {
  type HousekeepingFilter,
  type HousekeepingRoom,
  HousekeepingRepository,
  type HousekeepingSummary,
} from '../infrastructure/housekeeping-repository.ts';

export interface ActionOrigin {
  ip: string | undefined;
}

export interface HousekeepingBoard {
  items: HousekeepingRoom[];
  summary: HousekeepingSummary;
}

export interface StatusChange {
  /** The rooms asked for, in their new state. */
  items: HousekeepingRoom[];
  /** How many of them really changed (a room already in that state is left as is). */
  changed: number;
}

export class StatusNotAllowedError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'HOUSEKEEPING_STATUS_FORBIDDEN',
      title: 'Action non autorisée',
      detail: 'Votre rôle permet seulement de signaler une chambre à nettoyer.',
    });
  }
}

/**
 * Housekeeping board: the state of every active room, and its changes. A change of several
 * rooms is all or nothing, in one transaction with its audit log entries.
 */
export class HousekeepingService {
  readonly #sequelize: Sequelize;
  readonly #repository: HousekeepingRepository;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
    this.#repository = new HousekeepingRepository(sequelize);
  }

  async board(filter: HousekeepingFilter): Promise<HousekeepingBoard> {
    const [items, summary] = await Promise.all([
      this.#repository.listRooms(filter),
      this.#repository.summary(),
    ]);
    return { items, summary };
  }

  async changeStatus(
    actor: StaffUser,
    roomIds: readonly string[],
    status: HousekeepingStatus,
    origin: ActionOrigin,
  ): Promise<StatusChange> {
    if (!canSetStatus(actor.role, status)) {
      throw new StatusNotAllowedError();
    }
    const ids = [...new Set(roomIds)];
    const changed = await this.#sequelize.transaction(async (transaction) => {
      const rooms = await this.#repository.lockRooms(ids, transaction);
      if (rooms.length !== ids.length || rooms.some((room) => !room.isActive)) {
        throw new NotFoundError('Une ou plusieurs chambres n’existent pas ou sont désactivées.');
      }
      const toChange = rooms.filter((room) => room.status !== status);
      if (toChange.length === 0) {
        return 0;
      }
      await this.#repository.setStatus(toChange.map((room) => room.id), status, transaction);
      for (const room of toChange) {
        await recordAudit(
          this.#sequelize,
          {
            actorType: 'staff',
            actorUserId: actor.id,
            action: 'room.housekeeping_changed',
            entityType: 'room',
            entityId: room.id,
            changes: { housekeepingStatus: { from: room.status, to: status } },
            ipAddress: origin.ip,
          },
          transaction,
        );
      }
      return toChange.length;
    });
    return { items: await this.#repository.listRoomsById(ids), changed };
  }
}
