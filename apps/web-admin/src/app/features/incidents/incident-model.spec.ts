import { describe, expect, it } from 'vitest';
import {
  assigneeText,
  canAssign,
  eventText,
  formatDateTime,
  type IncidentEvent,
  placeOf,
  statusActions,
} from './incident-model';

const TECHNICIAN = { id: 't1', firstName: 'Karim', lastName: 'Benali' };

function event(changes: Partial<IncidentEvent>): IncidentEvent {
  return {
    id: '1',
    type: 'status_change',
    fromStatus: null,
    toStatus: null,
    comment: null,
    actor: null,
    createdAt: '2026-11-01T13:05:00Z',
    ...changes,
  };
}

describe('statusActions', () => {
  it('offers technicians to start then resolve', () => {
    const targets = (status: Parameters<typeof statusActions>[0]): string[] =>
      statusActions(status, 'technician').map((action) => action.to);
    expect(targets('reported')).toEqual(['in_progress', 'resolved']);
    expect(targets('in_progress')).toEqual(['resolved']);
    expect(targets('resolved')).toEqual([]);
  });

  it('offers the management to close or reopen a resolved incident', () => {
    expect(statusActions('resolved', 'direction').map((action) => action.label)).toEqual([
      'Clôturer',
      'Rouvrir',
    ]);
    expect(statusActions('closed', 'direction')).toEqual([]);
  });

  it('offers nothing to reception and housekeeping', () => {
    expect(statusActions('reported', 'reception')).toEqual([]);
    expect(statusActions('in_progress', 'housekeeping')).toEqual([]);
  });
});

describe('canAssign', () => {
  it('lets management and reception assign an incident that is not closed', () => {
    expect(canAssign('reported', 'reception')).toBe(true);
    expect(canAssign('resolved', 'direction')).toBe(true);
    expect(canAssign('closed', 'direction')).toBe(false);
    expect(canAssign('reported', 'technician')).toBe(false);
  });
});

describe('texts', () => {
  it('names the place and the people', () => {
    expect(placeOf({ room: { id: 'r', number: '214' }, location: null })).toBe('Chambre 214');
    expect(placeOf({ room: null, location: 'Ascenseur' })).toBe('Ascenseur');
    expect(assigneeText({ assignedTo: null, externalContractor: null })).toBe('Personne');
    expect(assigneeText({ assignedTo: TECHNICIAN, externalContractor: 'Plomberie' })).toBe(
      'Karim Benali, Plomberie',
    );
  });

  it('writes the date at the hotel time', () => {
    // 13:05 UTC is 14:05 in Marseille in November (UTC+1).
    expect(formatDateTime('2026-11-01T13:05:00Z')).toBe('1 nov. 2026 à 14:05');
  });

  it('says what each line of the history is', () => {
    expect(eventText(event({ toStatus: 'reported' }))).toBe('Panne signalée');
    expect(eventText(event({ fromStatus: 'reported', toStatus: 'in_progress' }))).toBe(
      'Passée « en cours »',
    );
    expect(eventText(event({ type: 'comment', comment: 'Joint changé.' }))).toBe('Commentaire');
    expect(eventText(event({ type: 'assignment' }))).toBe('Assignation modifiée');
  });
});
