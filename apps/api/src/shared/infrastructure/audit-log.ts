import type { Sequelize, Transaction } from 'sequelize';

/**
 * Journal of the sensitive actions (table audit_logs, append-only: the database refuses any
 * change or deletion younger than one year). Never store a password, token or secret in
 * `changes`.
 */
export interface AuditEntry {
  /** 'staff' when a logged-in staff member acts; 'system' for anonymous or automatic actions. */
  actorType: 'staff' | 'system';
  actorUserId?: string;
  /** « entity.verb », lowercase, for example « user.login_failed ». */
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown>;
  ipAddress?: string | undefined;
}

export async function recordAudit(
  sequelize: Sequelize,
  entry: AuditEntry,
  transaction?: Transaction,
): Promise<void> {
  await sequelize.query(
    `INSERT INTO audit_logs (actor_type, actor_user_id, action, entity_type, entity_id, changes,
                             ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    {
      bind: [
        entry.actorType,
        entry.actorUserId ?? null,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.changes === undefined ? null : JSON.stringify(entry.changes),
        entry.ipAddress ?? null,
      ],
      ...(transaction === undefined ? {} : { transaction }),
    },
  );
}
