import type { Role } from '../../core/auth/roles';

/**
 * Incidents as the API gives them (GET /admin/incidents) and the pure rules of the screens.
 * Same rights as the API: hiding a button is a comfort, never a protection.
 */

export type IncidentStatus = 'reported' | 'in_progress' | 'resolved' | 'closed';
export type IncidentPriority = 'urgent' | 'normal' | 'low';

export interface PersonName {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Incident {
  id: string;
  reference: string;
  room: { id: string; number: string } | null;
  location: string | null;
  title: string;
  description: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  blocksRoom: boolean;
  roomBlocked: boolean;
  reportedAt: string;
  reportedBy: PersonName;
  assignedTo: PersonName | null;
  externalContractor: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface IncidentEvent {
  id: string;
  type: 'status_change' | 'assignment' | 'comment';
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  comment: string | null;
  actor: PersonName | null;
  createdAt: string;
}

/** A stay booked in the room while the incident keeps it out of service. */
export interface AffectedStay {
  reservationId: string;
  reference: string;
  checkIn: string;
  checkOut: string;
}

export interface IncidentDetail extends Incident {
  events: IncidentEvent[];
  /** Stays to move to another room; empty once the room is back on sale. */
  affectedStays: AffectedStay[];
}

export interface RoomChoice {
  id: string;
  number: string;
  floor: number;
}

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: 'Signalée',
  in_progress: 'En cours',
  resolved: 'Résolue',
  closed: 'Clôturée',
};

export const PRIORITY_LABELS: Record<IncidentPriority, string> = {
  urgent: 'Urgente',
  normal: 'Normale',
  low: 'Basse',
};

/** A button of the incident page: the state it leads to, and its wording. */
export interface StatusAction {
  to: IncidentStatus;
  label: string;
}

/**
 * Changes of state this role may make on an incident in this state (same table as the API):
 * technicians start and resolve; management also closes a resolved incident or reopens it.
 */
export function statusActions(status: IncidentStatus, role: Role | undefined): StatusAction[] {
  const technical = role === 'technician' || role === 'direction';
  const actions: StatusAction[] = [];
  if (status === 'reported' && technical) {
    actions.push({ to: 'in_progress', label: 'Démarrer' });
  }
  if ((status === 'reported' || status === 'in_progress') && technical) {
    actions.push({ to: 'resolved', label: 'Marquer résolue' });
  }
  if (status === 'resolved' && role === 'direction') {
    actions.push({ to: 'closed', label: 'Clôturer' }, { to: 'in_progress', label: 'Rouvrir' });
  }
  return actions;
}

/** Management and reception assign an incident that is not closed. */
export function canAssign(status: IncidentStatus, role: Role | undefined): boolean {
  return status !== 'closed' && (role === 'direction' || role === 'reception');
}

/** Management and reception move the guests to another room (and open the reservations). */
export function movesGuests(role: Role | undefined): boolean {
  return role === 'direction' || role === 'reception';
}

/**
 * « Attention : la chambre 204 est attribuée à un séjour pendant la panne : changez-le de
 * chambre. »; the other roles are asked to warn the reception.
 */
export function affectedTitle(room: string, count: number, canMove: boolean): string {
  const stays = count === 1 ? 'un séjour' : `${count} séjours`;
  const them = count === 1 ? 'changez-le' : 'changez-les';
  const action = canMove ? `${them} de chambre` : 'prévenez la réception';
  return `Attention : la chambre ${room} est attribuée à ${stays} pendant la panne : ${action}.`;
}

/** « Chambre 214 », or the place typed by the reporter. */
export function placeOf(incident: Pick<Incident, 'room' | 'location'>): string {
  if (incident.room !== null) {
    return `Chambre ${incident.room.number}`;
  }
  return incident.location ?? '';
}

export function fullName(person: PersonName | null): string {
  return person === null ? '' : `${person.firstName} ${person.lastName}`;
}

/** « Technicien Martin, Plomberie du Panier », or « Personne ». */
export function assigneeText(
  incident: Pick<Incident, 'assignedTo' | 'externalContractor'>,
): string {
  const names = [fullName(incident.assignedTo), incident.externalContractor ?? ''];
  const known = names.filter((name) => name !== '');
  return known.length === 0 ? 'Personne' : known.join(', ');
}

/** « 1 nov. 2026 à 14:05 », in the hotel's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  const time = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
  return `${day} à ${time}`;
}

/** What one line of the history says. */
export function eventText(event: IncidentEvent): string {
  if (event.type === 'assignment') {
    return 'Assignation modifiée';
  }
  if (event.type === 'comment') {
    return 'Commentaire';
  }
  if (event.fromStatus === null && event.toStatus !== null) {
    return 'Panne signalée';
  }
  const to = event.toStatus === null ? '' : STATUS_LABELS[event.toStatus].toLowerCase();
  return `Passée « ${to} »`;
}
