import { createHash, randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import { type Sequelize, type Transaction, UniqueConstraintError } from 'sequelize';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.ts';
import { recordAudit } from '../../../shared/infrastructure/audit-log.ts';
import { maskEmail } from '../../../shared/infrastructure/logger.ts';
import type { Mailer } from '../../../shared/infrastructure/mailer.ts';
import {
  ACCOUNT_MANAGER_ROLE,
  INVITATION_LINK_MINUTES,
  RESET_LINK_MINUTES,
  type Role,
  type StaffUser,
} from '../domain/identity-rules.ts';
import {
  hashPassword,
  unusablePasswordHash,
  verifyAgainstDummy,
  verifyPassword,
} from '../infrastructure/password-hasher.ts';
import type { UserRecord, UserRepository, UserSummary } from '../infrastructure/user-repository.ts';

/**
 * Use cases of the staff accounts: login, password change and reset, account management by the
 * management. The HTTP layer handles sessions and cookies; everything else is here.
 */

/** Same answer whatever went wrong, so that nobody can find out which addresses exist. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      title: 'Connexion impossible',
      detail:
        'E-mail ou mot de passe incorrect, ou compte temporairement bloqué. ' +
        'Après 5 essais erronés, le compte est bloqué 15 minutes.',
    });
  }
}

export class InvalidResetTokenError extends AppError {
  constructor() {
    super({
      status: 400,
      code: 'INVALID_RESET_TOKEN',
      title: 'Lien invalide',
      detail: 'Ce lien a expiré ou a déjà servi. Demandez un nouveau lien.',
    });
  }
}

/** Where a request comes from, for the audit trail. */
export interface RequestOrigin {
  ip: string | undefined;
}

export interface UserChanges {
  firstName?: string | undefined;
  lastName?: string | undefined;
  role?: Role | undefined;
  isActive?: boolean | undefined;
}

export interface IdentityServiceDependencies {
  sequelize: Sequelize;
  users: UserRepository;
  mailer: Mailer;
  /** Address of the staff tool; the e-mailed links point to it. */
  adminAppUrl: string;
  logger: Logger;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toStaffUser(user: UserRecord): StaffUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

export class IdentityService {
  readonly #deps: IdentityServiceDependencies;

  constructor(deps: IdentityServiceDependencies) {
    this.#deps = deps;
  }

  // --- Login -------------------------------------------------------------------------------

  /**
   * Checks e-mail and password. Unknown address, deactivated or locked account, wrong
   * password: always the same error, after the same amount of work.
   */
  async authenticate(email: string, password: string, origin: RequestOrigin): Promise<StaffUser> {
    const { users, logger } = this.#deps;
    const user = await users.findByEmail(email);
    if (user === undefined) {
      await verifyAgainstDummy(password);
      logger.info({ email: maskEmail(email) }, 'connexion refusée : adresse inconnue');
      throw new InvalidCredentialsError();
    }
    if (!user.isActive || user.isLocked) {
      await verifyAgainstDummy(password);
      await this.#audit('system', undefined, 'user.login_failed', user.id, origin, {
        reason: user.isActive ? 'locked' : 'inactive',
      });
      throw new InvalidCredentialsError();
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      const { locked } = await users.recordFailedLogin(user.id);
      await this.#audit('system', undefined, 'user.login_failed', user.id, origin, {
        reason: 'wrong_password',
      });
      if (locked) {
        await this.#audit('system', undefined, 'user.locked', user.id, origin);
        logger.warn({ userId: user.id }, 'compte bloqué après trop d’essais erronés');
      }
      throw new InvalidCredentialsError();
    }
    await users.recordSuccessfulLogin(user.id);
    await this.#audit('staff', user.id, 'user.login_succeeded', user.id, origin);
    return toStaffUser(user);
  }

  // --- Own password ------------------------------------------------------------------------

  /** Changes one's own password; the other sessions of the account are closed. */
  async changePassword(
    actor: StaffUser,
    currentPassword: string,
    newPassword: string,
    currentSessionId: string,
    origin: RequestOrigin,
  ): Promise<void> {
    const { users } = this.#deps;
    const user = await users.findById(actor.id);
    if (user === undefined || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new ValidationError([
        { field: 'currentPassword', message: 'Le mot de passe actuel est incorrect.' },
      ]);
    }
    if (currentPassword === newPassword) {
      throw new ValidationError([
        { field: 'newPassword', message: 'Le nouveau mot de passe doit être différent.' },
      ]);
    }
    const passwordHash = await hashPassword(newPassword);
    await this.#deps.sequelize.transaction(async (transaction) => {
      await users.updatePassword(actor.id, passwordHash, transaction);
      await users.revokeSessions(actor.id, currentSessionId, transaction);
      await this.#audit('staff', actor.id, 'user.password_changed', actor.id, origin, undefined, {
        transaction,
      });
    });
  }

  // --- Forgotten password ------------------------------------------------------------------

  /**
   * Sends a reset link if the address belongs to an active account. Always completes without
   * error, whether the address exists or not: the answer reveals nothing.
   */
  async requestPasswordReset(email: string, origin: RequestOrigin): Promise<void> {
    const { users, logger } = this.#deps;
    const user = await users.findByEmail(email);
    if (user === undefined || !user.isActive) {
      logger.info({ email: maskEmail(email) }, 'réinitialisation demandée pour un compte absent');
      return;
    }
    const token = await this.#issueLink(user.id, RESET_LINK_MINUTES);
    await this.#audit('system', undefined, 'user.password_reset_requested', user.id, origin);
    try {
      await this.#sendResetMail(user, token);
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'envoi du lien de réinitialisation en échec');
    }
  }

  /** Sets a new password from an e-mailed link; every session of the account is closed. */
  async resetPassword(token: string, newPassword: string, origin: RequestOrigin): Promise<void> {
    const { sequelize, users } = this.#deps;
    const passwordHash = await hashPassword(newPassword);
    await sequelize.transaction(async (transaction) => {
      const userId = await users.consumeResetToken(hashToken(token), transaction);
      if (userId === undefined) {
        throw new InvalidResetTokenError();
      }
      await users.updatePassword(userId, passwordHash, transaction);
      await users.revokeSessions(userId, undefined, transaction);
      await this.#audit('system', undefined, 'user.password_reset', userId, origin, undefined, {
        transaction,
      });
    });
  }

  // --- Account management (management only; checked by the HTTP layer) -------------------

  listUsers(): Promise<UserSummary[]> {
    return this.#deps.users.list();
  }

  /**
   * Creates an account WITHOUT password: the person receives a link (48 h) to choose it. If
   * the e-mail cannot be sent, the account exists anyway and `invitationSent` is false: the
   * management can send a new link.
   */
  async createUser(
    actor: StaffUser,
    input: { email: string; firstName: string; lastName: string; role: Role },
    origin: RequestOrigin,
  ): Promise<{ user: UserSummary; invitationSent: boolean }> {
    const { sequelize, users, logger } = this.#deps;
    const passwordHash = await unusablePasswordHash();
    const token = randomBytes(32).toString('base64url');
    let user: UserSummary;
    try {
      user = await sequelize.transaction(async (transaction) => {
        const created = await users.create({ ...input, passwordHash }, transaction);
        await users.createResetToken(
          created.id,
          hashToken(token),
          INVITATION_LINK_MINUTES,
          transaction,
        );
        await this.#audit(
          'staff',
          actor.id,
          'user.created',
          created.id,
          origin,
          {
            email: maskEmail(created.email),
            role: created.role,
          },
          { transaction },
        );
        return created;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictError(
          'EMAIL_ALREADY_USED',
          'Adresse déjà utilisée',
          'Un compte existe déjà avec cette adresse e-mail.',
        );
      }
      throw error;
    }
    let invitationSent = true;
    try {
      await this.#sendInvitationMail(user, token);
    } catch (error) {
      invitationSent = false;
      logger.error({ err: error, userId: user.id }, 'envoi de l’invitation en échec');
    }
    return { user, invitationSent };
  }

  /**
   * Changes name, role or activity. Safeguards: a manager cannot deactivate or demote
   * themself, and the last active management account cannot be removed. A deactivated account
   * or a changed role closes the account's sessions at once.
   */
  async updateUser(
    actor: StaffUser,
    userId: string,
    changes: UserChanges,
    origin: RequestOrigin,
  ): Promise<UserSummary> {
    const { sequelize, users } = this.#deps;
    await sequelize.transaction(async (transaction) => {
      const target = await users.findById(userId, transaction, true);
      if (target === undefined) {
        throw new NotFoundError('Ce compte n’existe pas.');
      }
      const next = {
        firstName: changes.firstName ?? target.firstName,
        lastName: changes.lastName ?? target.lastName,
        role: changes.role ?? target.role,
        isActive: changes.isActive ?? target.isActive,
      };
      const losesManagement =
        target.role === ACCOUNT_MANAGER_ROLE &&
        target.isActive &&
        (next.role !== ACCOUNT_MANAGER_ROLE || !next.isActive);

      if (losesManagement && target.id === actor.id) {
        throw new ConflictError(
          'CANNOT_REMOVE_OWN_ACCESS',
          'Action impossible sur votre propre compte',
          'Vous ne pouvez ni désactiver votre compte ni retirer votre propre rôle de direction.',
        );
      }
      if (losesManagement) {
        const managers = await users.lockActiveManagers(ACCOUNT_MANAGER_ROLE, transaction);
        if (managers.length <= 1) {
          throw new ConflictError(
            'LAST_MANAGER_ACCOUNT',
            'Dernier compte de direction',
            'L’hôtel doit garder au moins un compte de direction actif.',
          );
        }
      }

      await users.update(userId, next, transaction);
      if (next.role !== target.role || !next.isActive) {
        await users.revokeSessions(userId, undefined, transaction);
      }

      const action =
        target.isActive && !next.isActive
          ? 'user.deactivated'
          : !target.isActive && next.isActive
            ? 'user.reactivated'
            : 'user.updated';
      const changed: Record<string, unknown> = {};
      for (const key of ['firstName', 'lastName', 'role', 'isActive'] as const) {
        if (next[key] !== target[key]) {
          changed[key] = { from: target[key], to: next[key] };
        }
      }
      await this.#audit('staff', actor.id, action, userId, origin, changed, { transaction });
    });
    const updated = (await users.list()).find((user) => user.id === userId);
    if (updated === undefined) {
      throw new NotFoundError('Ce compte n’existe pas.');
    }
    return updated;
  }

  /** The management sends a reset link to a staff member who forgot their password. */
  async sendResetLink(actor: StaffUser, userId: string, origin: RequestOrigin): Promise<void> {
    const user = await this.#deps.users.findById(userId);
    if (user === undefined) {
      throw new NotFoundError('Ce compte n’existe pas.');
    }
    if (!user.isActive) {
      throw new ConflictError(
        'USER_INACTIVE',
        'Compte désactivé',
        'Réactivez le compte avant de lui envoyer un lien.',
      );
    }
    const token = await this.#issueLink(user.id, RESET_LINK_MINUTES);
    await this.#audit('staff', actor.id, 'user.password_reset_requested', user.id, origin);
    await this.#sendResetMail(user, token);
  }

  // --- Internals ---------------------------------------------------------------------------

  /** Creates a single-use link token; only its SHA-256 hash is stored. */
  async #issueLink(userId: string, minutes: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.#deps.users.createResetToken(userId, hashToken(token), minutes);
    return token;
  }

  /** The token goes after « # »: browsers never send it to servers, so it never reaches logs. */
  #link(token: string): string {
    const url = new URL('/mot-de-passe', this.#deps.adminAppUrl);
    url.hash = `jeton=${token}`;
    return url.toString();
  }

  async #sendResetMail(user: { email: string; firstName: string }, token: string): Promise<void> {
    await this.#deps.mailer.send({
      to: user.email,
      subject: 'Réinitialisation de votre mot de passe — Hôtel Riad Vieux-Port',
      text:
        `Bonjour ${user.firstName},\n\n` +
        `Pour choisir un nouveau mot de passe, ouvrez ce lien dans les ${RESET_LINK_MINUTES} ` +
        `minutes :\n${this.#link(token)}\n\n` +
        'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de ' +
        'passe actuel reste valable.',
    });
  }

  async #sendInvitationMail(user: { email: string; firstName: string }, token: string) {
    await this.#deps.mailer.send({
      to: user.email,
      subject: 'Votre compte — Hôtel Riad Vieux-Port',
      text:
        `Bonjour ${user.firstName},\n\n` +
        'Un compte vient d’être créé pour vous dans l’outil de gestion de l’hôtel.\n' +
        `Choisissez votre mot de passe avec ce lien, valable ${INVITATION_LINK_MINUTES / 60} ` +
        `heures :\n${this.#link(token)}`,
    });
  }

  #audit(
    actorType: 'staff' | 'system',
    actorUserId: string | undefined,
    action: string,
    userId: string,
    origin: RequestOrigin,
    changes?: Record<string, unknown>,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    return recordAudit(
      this.#deps.sequelize,
      {
        actorType,
        ...(actorUserId === undefined ? {} : { actorUserId }),
        action,
        entityType: 'user',
        entityId: userId,
        ...(changes === undefined ? {} : { changes }),
        ipAddress: origin.ip,
      },
      options.transaction,
    );
  }
}
