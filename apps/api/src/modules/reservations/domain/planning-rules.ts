import type { FieldError } from '../../../shared/domain/errors.ts';
import { addDays } from '../../catalog/domain/pricing.ts';
import { ROLES, type Role } from '../../identity/domain/identity-rules.ts';

/**
 * Rules of the planning (UI/UX specification, section 5.C): a grid of rooms × days, read by
 * every role; the guests' names only for the roles that deal with the customers.
 */

/** Every staff member reads the planning; housekeeping and technicians to know who is in. */
export const PLANNING_ROLES: readonly Role[] = ROLES;

/** The longest period shown at once (31 days: a month). */
export const PLANNING_MAX_DAYS = 31;

/**
 * Housekeeping and technicians see that a room is taken, never by whom: they have no access to
 * the customers either (data minimisation, GDPR).
 */
export function seesGuestNames(role: Role): boolean {
  return role === 'direction' || role === 'reception';
}

/** Problems of a period « from » to « to », both days included. */
export function planningPeriodErrors(from: string, to: string): FieldError[] {
  if (to < from) {
    return [{ field: 'to', message: 'Le dernier jour doit suivre ou égaler le premier.' }];
  }
  if (to >= addDays(from, PLANNING_MAX_DAYS)) {
    return [{ field: 'to', message: `${PLANNING_MAX_DAYS} jours au plus.` }];
  }
  return [];
}
