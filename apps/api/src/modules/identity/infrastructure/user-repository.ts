import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import {
  LOCK_DURATION_MINUTES,
  MAX_FAILED_LOGINS,
  type Role,
  type StaffUser,
} from '../domain/identity-rules.ts';

/**
 * Access to the staff accounts, the reset tokens and the sessions, in plain SQL with bound
 * parameters (never any value concatenated into the SQL text).
 */

export interface UserRecord extends StaffUser {
  isActive: boolean;
  passwordHash: string;
  /** Computed by the database: locked_until is still in the future. */
  isLocked: boolean;
  lastLoginAt: Date | null;
}

export interface UserSummary extends StaffUser {
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const USER_COLUMNS = `
  id, email::text AS email, first_name AS "firstName", last_name AS "lastName", role,
  is_active AS "isActive", password_hash AS "passwordHash",
  coalesce(locked_until > now(), false) AS "isLocked", last_login_at AS "lastLoginAt"`;

function options(transaction: Transaction | undefined): { transaction?: Transaction } {
  return transaction === undefined ? {} : { transaction };
}

export class UserRepository {
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
      ...options(transaction),
    });
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const rows = await this.#select<UserRecord>(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
      [email],
    );
    return rows[0];
  }

  /** `forUpdate` locks the row until the end of the transaction. */
  async findById(
    id: string,
    transaction?: Transaction,
    forUpdate = false,
  ): Promise<UserRecord | undefined> {
    const rows = await this.#select<UserRecord>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
      transaction,
    );
    return rows[0];
  }

  async findActiveStaff(id: string): Promise<StaffUser | undefined> {
    const rows = await this.#select<StaffUser>(
      `SELECT id, email::text AS email, first_name AS "firstName", last_name AS "lastName", role
       FROM users WHERE id = $1 AND is_active`,
      [id],
    );
    return rows[0];
  }

  async list(): Promise<UserSummary[]> {
    return this.#select<UserSummary>(
      `SELECT id, email::text AS email, first_name AS "firstName", last_name AS "lastName", role,
              is_active AS "isActive", last_login_at AS "lastLoginAt", created_at AS "createdAt"
       FROM users ORDER BY is_active DESC, last_name, first_name`,
      [],
    );
  }

  /**
   * Counts one more wrong password. The fifth in a row locks the account for 15 minutes and
   * restarts the count. Done in a single statement: two simultaneous attempts cannot both
   * escape the count.
   */
  async recordFailedLogin(id: string): Promise<{ locked: boolean }> {
    const rows = await this.#select<{ locked: boolean }>(
      `UPDATE users SET
         failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0
                                      ELSE failed_login_attempts + 1 END,
         locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                             THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1
       RETURNING coalesce(locked_until > now(), false) AS locked`,
      [id, MAX_FAILED_LOGINS, LOCK_DURATION_MINUTES],
    );
    return { locked: rows[0]?.locked ?? false };
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.#sequelize.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
       WHERE id = $1`,
      { bind: [id] },
    );
  }

  /** New password; also lifts any lock, since the person proved who they are. */
  async updatePassword(id: string, passwordHash: string, transaction?: Transaction): Promise<void> {
    await this.#sequelize.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(),
                        failed_login_attempts = 0, locked_until = NULL
       WHERE id = $1`,
      { bind: [id, passwordHash], ...options(transaction) },
    );
  }

  async create(
    input: { email: string; firstName: string; lastName: string; role: Role; passwordHash: string },
    transaction: Transaction,
  ): Promise<UserSummary> {
    const rows = await this.#select<UserSummary>(
      `INSERT INTO users (email, first_name, last_name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email::text AS email, first_name AS "firstName", last_name AS "lastName",
                 role, is_active AS "isActive", last_login_at AS "lastLoginAt",
                 created_at AS "createdAt"`,
      [input.email, input.firstName, input.lastName, input.role, input.passwordHash],
      transaction,
    );
    const created = rows[0];
    if (created === undefined) {
      throw new Error('création du compte sans résultat');
    }
    return created;
  }

  async update(
    id: string,
    values: { firstName: string; lastName: string; role: Role; isActive: boolean },
    transaction: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `UPDATE users SET first_name = $2, last_name = $3, role = $4, is_active = $5,
              failed_login_attempts = CASE WHEN $5 AND NOT is_active THEN 0
                                           ELSE failed_login_attempts END,
              locked_until = CASE WHEN $5 AND NOT is_active THEN NULL ELSE locked_until END
       WHERE id = $1`,
      { bind: [id, values.firstName, values.lastName, values.role, values.isActive], transaction },
    );
  }

  /** Active management accounts, locked until the end of the transaction. */
  async lockActiveManagers(role: Role, transaction: Transaction): Promise<string[]> {
    const rows = await this.#select<{ id: string }>(
      `SELECT id FROM users WHERE role = $1 AND is_active ORDER BY id FOR UPDATE`,
      [role],
      transaction,
    );
    return rows.map((row) => row.id);
  }

  /**
   * Closes the sessions of an account (deactivation, role or password change), except
   * `keepSessionId` when the person keeps working in the current one.
   */
  async revokeSessions(
    userId: string,
    keepSessionId?: string,
    transaction?: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `DELETE FROM user_sessions WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)`,
      { bind: [userId, keepSessionId ?? null], ...options(transaction) },
    );
  }

  /**
   * Stores the hash of a new single-use link token, valid `minutes`; earlier unused tokens of
   * the account are cancelled, so that only the last e-mail works.
   */
  async createResetToken(
    userId: string,
    tokenHash: string,
    minutes: number,
    transaction?: Transaction,
  ): Promise<void> {
    await this.#sequelize.query(
      `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      { bind: [userId], ...options(transaction) },
    );
    await this.#sequelize.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      { bind: [userId, tokenHash, minutes], ...options(transaction) },
    );
  }

  /** Uses up a valid token (unused, not expired, active account) and returns its account. */
  async consumeResetToken(
    tokenHash: string,
    transaction: Transaction,
  ): Promise<string | undefined> {
    const rows = await this.#select<{ userId: string }>(
      `UPDATE password_reset_tokens t SET used_at = now()
       FROM users u
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
         AND u.id = t.user_id AND u.is_active
       RETURNING t.user_id AS "userId"`,
      [tokenHash],
      transaction,
    );
    return rows[0]?.userId;
  }
}
