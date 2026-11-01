import type { Role } from '../../identity/domain/identity-rules.ts';

/**
 * Rules of the incidents (module 7, decisions validated on 1 November 2026):
 *  - every staff member reports an incident and sees the list; anyone may tick « room
 *    unusable », which takes the room out of sale at once (even if it is booked: the alert to
 *    the reception arrives with the reservations module);
 *  - technicians move an incident to « in progress » or « resolved »; management and reception
 *    assign it; management closes it or reopens a resolved one;
 *  - the room is released when the incident is resolved, blocked again if it is reopened;
 *  - photos and e-mail notifications come later (file storage, Brevo).
 */

export const INCIDENT_STATUSES = ['reported', 'in_progress', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_PRIORITIES = ['urgent', 'normal', 'low'] as const;
export type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number];

export const INCIDENT_READ_ROLES: readonly Role[] = [
  'direction',
  'reception',
  'housekeeping',
  'technician',
];
export const INCIDENT_ASSIGN_ROLES: readonly Role[] = ['direction', 'reception'];

/** Only technicians can be assigned an incident (external contractors are named in text). */
export const ASSIGNABLE_ROLE: Role = 'technician';

/** Allowed changes of state, and who may make each one. */
const TRANSITIONS: Record<IncidentStatus, Partial<Record<IncidentStatus, readonly Role[]>>> = {
  reported: { in_progress: ['direction', 'technician'], resolved: ['direction', 'technician'] },
  in_progress: { resolved: ['direction', 'technician'] },
  resolved: { closed: ['direction'], in_progress: ['direction'] },
  closed: {},
};

export type TransitionCheck = 'allowed' | 'invalid' | 'forbidden';

export function checkTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  role: Role,
): TransitionCheck {
  const roles = TRANSITIONS[from][to];
  if (roles === undefined) {
    return 'invalid';
  }
  return roles.includes(role) ? 'allowed' : 'forbidden';
}

/** Words of the states in the messages shown to the staff. */
export const STATUS_WORDS: Record<IncidentStatus, string> = {
  reported: 'signalée',
  in_progress: 'en cours',
  resolved: 'résolue',
  closed: 'clôturée',
};
