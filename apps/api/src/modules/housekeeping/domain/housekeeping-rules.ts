import type { Role } from '../../identity/domain/identity-rules.ts';

/**
 * Rules of the housekeeping (module 6, decisions validated on 1 November 2026):
 *  - two states only: clean, or to be cleaned (« dirty »);
 *  - housekeeping and management mark a room clean or to be cleaned; the reception only marks
 *    it to be cleaned (a guest who left early, for example); technicians have no access;
 *  - only active rooms are concerned: a deactivated room leaves the housekeeping;
 *  - every change is written to the audit log (who, when, before → after). The automatic
 *    change at a guest's departure arrives with the reservations module.
 */

export const HOUSEKEEPING_STATUSES = ['clean', 'dirty'] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];

export const HOUSEKEEPING_READ_ROLES: readonly Role[] = ['direction', 'reception', 'housekeeping'];

/** Who may set each state. */
export const HOUSEKEEPING_WRITE_ROLES: Record<HousekeepingStatus, readonly Role[]> = {
  clean: ['direction', 'housekeeping'],
  dirty: ['direction', 'reception', 'housekeeping'],
};

/** At most this many rooms in one grouped change (the hotel has 85). */
export const MAX_ROOMS_PER_CHANGE = 200;

export function canSetStatus(role: Role, status: HousekeepingStatus): boolean {
  return HOUSEKEEPING_WRITE_ROLES[status].includes(role);
}
