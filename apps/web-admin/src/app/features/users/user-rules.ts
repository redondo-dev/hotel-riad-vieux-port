import type { Role, StaffUser } from '../../core/auth/roles';

/** An account as listed by GET /admin/users. */
export interface UserSummary extends StaffUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Permission {
  allowed: boolean;
  /** Why the button is disabled, shown next to it. */
  reason?: string;
}

const MANAGER: Role = 'direction';

function activeManagers(users: readonly UserSummary[]): number {
  return users.filter((user) => user.role === MANAGER && user.isActive).length;
}

/**
 * Same safeguards as the API, to explain BEFORE the click why an action is impossible
 * (UI/UX specification, section 5.L). The API refuses them anyway.
 */
export function canDeactivate(
  target: UserSummary,
  actor: StaffUser,
  users: readonly UserSummary[],
): Permission {
  if (!target.isActive) {
    return { allowed: false, reason: 'Ce compte est déjà désactivé.' };
  }
  if (target.id === actor.id) {
    return { allowed: false, reason: 'Vous ne pouvez pas désactiver votre propre compte.' };
  }
  if (target.role === MANAGER && activeManagers(users) <= 1) {
    return {
      allowed: false,
      reason: 'L’hôtel doit garder au moins un compte de direction actif.',
    };
  }
  return { allowed: true };
}

export function canChangeRole(
  target: UserSummary,
  actor: StaffUser,
  users: readonly UserSummary[],
  newRole: Role,
): Permission {
  if (newRole === target.role) {
    return { allowed: true };
  }
  if (target.id === actor.id && target.role === MANAGER) {
    return { allowed: false, reason: 'Vous ne pouvez pas retirer votre propre rôle de direction.' };
  }
  if (target.role === MANAGER && target.isActive && activeManagers(users) <= 1) {
    return {
      allowed: false,
      reason: 'L’hôtel doit garder au moins un compte de direction actif.',
    };
  }
  return { allowed: true };
}

/** « 12/03/2026 à 09:41 », or « Jamais » for an account that never logged in. */
export function formatLastLogin(value: string | null): string {
  if (value === null) {
    return 'Jamais';
  }
  const date = new Date(value);
  const day = date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  const time = date.toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} à ${time}`;
}
