import { describe, expect, it } from 'vitest';
import type { Role } from '../../core/auth/roles';
import { canChangeRole, canDeactivate, formatLastLogin, type UserSummary } from './user-rules';

function user(id: string, role: Role, isActive = true): UserSummary {
  return {
    id,
    email: `${id}@test.example`,
    firstName: 'Test',
    lastName: id,
    role,
    isActive,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('canDeactivate', () => {
  const manager = user('m1', 'direction');
  const otherManager = user('m2', 'direction');
  const receptionist = user('r1', 'reception');

  it('lets the management deactivate a staff member', () => {
    expect(canDeactivate(receptionist, manager, [manager, receptionist]).allowed).toBe(true);
  });

  it('refuses one’s own account, with the reason', () => {
    const permission = canDeactivate(manager, manager, [manager, otherManager]);
    expect(permission.allowed).toBe(false);
    expect(permission.reason).toBe('Vous ne pouvez pas désactiver votre propre compte.');
  });

  it('allows deactivating a manager while another one stays active', () => {
    expect(canDeactivate(otherManager, manager, [manager, otherManager]).allowed).toBe(true);
  });

  it('refuses the only active management account (list out of date, for example)', () => {
    const inactiveManager = user('m3', 'direction', false);
    const permission = canDeactivate(otherManager, manager, [otherManager, inactiveManager]);
    expect(permission.allowed).toBe(false);
    expect(permission.reason).toBe('L’hôtel doit garder au moins un compte de direction actif.');
  });

  it('says when the account is already deactivated', () => {
    const inactive = user('r2', 'reception', false);
    expect(canDeactivate(inactive, manager, [manager, inactive]).reason).toBe(
      'Ce compte est déjà désactivé.',
    );
  });
});

describe('canChangeRole', () => {
  const manager = user('m1', 'direction');
  const otherManager = user('m2', 'direction');

  it('refuses to remove one’s own management role', () => {
    expect(canChangeRole(manager, manager, [manager, otherManager], 'reception').allowed).toBe(
      false,
    );
  });

  it('lets a manager demote another manager while one stays', () => {
    expect(canChangeRole(otherManager, manager, [manager, otherManager], 'reception').allowed).toBe(
      true,
    );
  });

  it('always allows keeping the same role', () => {
    expect(canChangeRole(manager, manager, [manager], 'direction').allowed).toBe(true);
  });
});

describe('formatLastLogin', () => {
  it('writes the date and time in Paris time', () => {
    expect(formatLastLogin('2026-03-12T08:41:00Z')).toBe('12/03/2026 à 09:41');
  });

  it('says « Jamais » for an account that never logged in', () => {
    expect(formatLastLogin(null)).toBe('Jamais');
  });
});
