import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn, type TestStaff } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Incidents against the test database: reporting, room blocks, changes of state by role,
 * assignment, comments and history. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 6 (rooms P601 and P602); the other files use other floors.
 */

const INCIDENTS = `${ADMIN}/incidents`;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type Agent = ReturnType<typeof request.agent>;

interface Session {
  agent: Agent;
  csrfToken: string;
}

interface IncidentBody {
  id: string;
  reference: string;
  status: string;
  priority: string;
  roomBlocked: boolean;
  events: { type: string; fromStatus: string | null; toStatus: string | null }[];
  [key: string]: unknown;
}

describe.skipIf(!hasTestDatabase)('incidents', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let manager: Session;
  let reception: Session;
  let housekeeper: Session;
  let technician: Session;
  let technicianAccount: TestStaff;
  let receptionAccount: TestStaff;
  let room: string;
  let otherRoom: string;
  let leak: IncidentBody;

  function send(session: Session, path: string): request.Test {
    return session.agent.post(`${INCIDENTS}${path}`).set('X-CSRF-Token', session.csrfToken);
  }

  async function openBlocks(incidentId: string): Promise<number> {
    const rows = await harness.rows<{ count: number }>(
      `SELECT count(*)::int AS count FROM room_blocks
        WHERE incident_id = $1 AND released_at IS NULL`,
      [incidentId],
    );
    return rows[0]?.count ?? 0;
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app();
    technicianAccount = await harness.createStaff('technician');
    receptionAccount = await harness.createStaff('reception');
    manager = await logIn(app, await harness.createStaff('direction'));
    reception = await logIn(app, receptionAccount);
    housekeeper = await logIn(app, await harness.createStaff('housekeeping'));
    technician = await logIn(app, technicianAccount);

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en,
         area_sqm, max_occupancy, base_occupancy, base_price_cents)
       VALUES ('panne-double', 'Double panne', 'Incident double', 'D', 'D', 'L', 'B',
               18, 2, 2, 9000)`,
    );
    const rooms = await harness.rows<{ id: string; number: string }>(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 6, c.id
         FROM room_categories c, (VALUES ('P601'), ('P602')) AS v (number)
        WHERE c.code = 'panne-double'
       RETURNING id, number`,
    );
    room = rooms.find((item) => item.number === 'P601')?.id ?? '';
    otherRoom = rooms.find((item) => item.number === 'P602')?.id ?? '';
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('reporting', () => {
    it('lets housekeeping report an unusable room, which is blocked at once', async () => {
      const response = await send(housekeeper, '').send({
        roomId: room,
        title: 'Fuite sous le lavabo',
        description: 'L’eau coule sur le sol de la salle de bains.',
        priority: 'urgent',
        blocksRoom: true,
      });

      expect(response.status).toBe(201);
      leak = response.body as IncidentBody;
      expect(leak.reference).toMatch(/^INC-\d{6}$/);
      expect(leak.status).toBe('reported');
      expect(leak.room).toEqual({ id: room, number: 'P601' });
      expect(leak.roomBlocked).toBe(true);
      expect(leak.events.map((event) => event.toStatus)).toEqual(['reported']);
      expect(await openBlocks(leak.id)).toBe(1);
    });

    it('accepts a place instead of a room, and asks for one of them', async () => {
      const place = await send(reception, '').send({
        location: 'Ascenseur',
        title: 'Ascenseur bloqué',
        description: 'Arrêté au 3e étage.',
        priority: 'normal',
      });
      expect(place.status).toBe(201);
      expect(place.body.roomBlocked).toBe(false);

      const nowhere = await send(reception, '').send({
        title: 'Panne',
        description: 'Quelque part.',
        priority: 'low',
      });
      expect(nowhere.status).toBe(400);
      expect(nowhere.body.errors[0].field).toBe('location');
    });

    it('refuses « unusable » for a place, and an unknown room', async () => {
      const place = await send(reception, '').send({
        location: 'Hall',
        title: 'Porte',
        description: 'La porte d’entrée frotte.',
        priority: 'low',
        blocksRoom: true,
      });
      expect(place.status).toBe(400);
      expect(place.body.errors[0].field).toBe('blocksRoom');

      const unknown = await send(reception, '').send({
        roomId: UNKNOWN_ID,
        title: 'Panne',
        description: 'Chambre inconnue.',
        priority: 'low',
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body.errors[0].field).toBe('roomId');
    });
  });

  describe('list', () => {
    it('shows the urgent incidents first, and filters by room', async () => {
      await send(technician, '').send({
        roomId: otherRoom,
        title: 'Ampoule grillée',
        description: 'Lampe de chevet.',
        priority: 'low',
      });
      const response = await reception.agent.get(INCIDENTS);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const priorities = (response.body.items as IncidentBody[]).map((item) => item.priority);
      expect(priorities[0]).toBe('urgent');
      expect(priorities.indexOf('low')).toBeGreaterThan(priorities.indexOf('normal'));

      const byRoom = await reception.agent.get(`${INCIDENTS}?roomId=${room}`);
      const references = (byRoom.body.items as IncidentBody[]).map((item) => item.reference);
      expect(references).toEqual([leak.reference]);
    });

    it('requires a staff session', async () => {
      expect((await request(app).get(INCIDENTS)).status).toBe(401);
    });

    it('lists the active rooms for the report form, to every role', async () => {
      const response = await technician.agent.get(`${INCIDENTS}/rooms`);
      expect(response.status).toBe(200);
      const numbers = (response.body.items as { number: string }[]).map((item) => item.number);
      expect(numbers).toContain('P601');
      expect(numbers).toContain('P602');
    });
  });

  describe('changes of state', () => {
    it('refuses a change of state to the reception', async () => {
      const response = await send(reception, `/${leak.id}/status`).send({ status: 'in_progress' });
      expect(response.status).toBe(403);
    });

    it('lets the technician start, then resolve; the room goes back on sale', async () => {
      const started = await send(technician, `/${leak.id}/status`).send({
        status: 'in_progress',
        comment: 'Joint à remplacer.',
      });
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('in_progress');
      expect(started.body.roomBlocked).toBe(true);

      const resolved = await send(technician, `/${leak.id}/status`).send({ status: 'resolved' });
      expect(resolved.status).toBe(200);
      expect(resolved.body.roomBlocked).toBe(false);
      expect(typeof resolved.body.resolvedAt).toBe('string');
      expect(await openBlocks(leak.id)).toBe(0);
    });

    it('refuses a change that does not exist, and closing to the technician', async () => {
      const back = await send(technician, `/${leak.id}/status`).send({ status: 'reported' });
      expect(back.status).toBe(409);
      expect(back.body.code).toBe('INCIDENT_TRANSITION_INVALID');

      const close = await send(technician, `/${leak.id}/status`).send({ status: 'closed' });
      expect(close.status).toBe(403);
    });

    it('lets the management reopen a resolved incident: the room is blocked again', async () => {
      const reopened = await send(manager, `/${leak.id}/status`).send({
        status: 'in_progress',
        comment: 'La fuite a repris.',
      });
      expect(reopened.status).toBe(200);
      expect(reopened.body.resolvedAt).toBe(null);
      expect(reopened.body.roomBlocked).toBe(true);
      expect(await openBlocks(leak.id)).toBe(1);
    });
  });

  describe('assignment and comments', () => {
    it('lets the reception assign a technician and an external contractor', async () => {
      const response = await send(reception, `/${leak.id}/assignment`).send({
        assignedTo: technicianAccount.id,
        externalContractor: 'Plomberie du Panier',
      });
      expect(response.status).toBe(200);
      expect(response.body.assignedTo.id).toBe(technicianAccount.id);
      expect(response.body.externalContractor).toBe('Plomberie du Panier');

      const mine = await technician.agent.get(`${INCIDENTS}?mine=true`);
      const references = (mine.body.items as IncidentBody[]).map((item) => item.reference);
      expect(references).toContain(leak.reference);
    });

    it('assigns technicians only, and only by management or reception', async () => {
      const notTechnician = await send(manager, `/${leak.id}/assignment`).send({
        assignedTo: receptionAccount.id,
        externalContractor: null,
      });
      expect(notTechnician.status).toBe(400);
      expect(notTechnician.body.errors[0].field).toBe('assignedTo');

      const byTechnician = await send(technician, `/${leak.id}/assignment`).send({
        assignedTo: null,
        externalContractor: null,
      });
      expect(byTechnician.status).toBe(403);
    });

    it('lists the technicians for the assignment, to management and reception only', async () => {
      const list = await reception.agent.get(`${INCIDENTS}/technicians`);
      expect(list.status).toBe(200);
      const ids = (list.body.items as { id: string }[]).map((item) => item.id);
      expect(ids).toContain(technicianAccount.id);
      expect(ids).not.toContain(receptionAccount.id);

      expect((await housekeeper.agent.get(`${INCIDENTS}/technicians`)).status).toBe(403);
    });

    it('keeps the whole history, comments included', async () => {
      const comment = await send(housekeeper, `/${leak.id}/comments`).send({
        comment: 'Le sol est encore humide.',
      });
      expect(comment.status).toBe(201);
      const types = (comment.body as IncidentBody).events.map((event) => event.type);
      expect(types).toEqual([
        'status_change',
        'status_change',
        'status_change',
        'status_change',
        'assignment',
        'comment',
      ]);
    });
  });

  describe('closing', () => {
    it('lets the management close a resolved incident, which then cannot change', async () => {
      await send(technician, `/${leak.id}/status`).send({ status: 'resolved' });
      const closed = await send(manager, `/${leak.id}/status`).send({ status: 'closed' });
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('closed');

      const comment = await send(housekeeper, `/${leak.id}/comments`).send({ comment: 'Merci.' });
      expect(comment.status).toBe(409);
      expect(comment.body.code).toBe('INCIDENT_CLOSED');

      const open = await reception.agent.get(INCIDENTS);
      const references = (open.body.items as IncidentBody[]).map((item) => item.reference);
      expect(references).not.toContain(leak.reference);
      const all = await reception.agent.get(`${INCIDENTS}?includeClosed=true`);
      const allReferences = (all.body.items as IncidentBody[]).map((item) => item.reference);
      expect(allReferences).toContain(leak.reference);
    });

    it('answers 404 for an unknown incident', async () => {
      expect((await reception.agent.get(`${INCIDENTS}/${UNKNOWN_ID}`)).status).toBe(404);
    });
  });
});
