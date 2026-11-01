import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Housekeeping against the test database: board, changes by role, grouped changes and audit
 * log. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 7 (rooms H701 to H704); the other files use other floors.
 */

const HOUSEKEEPING = `${ADMIN}/housekeeping`;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type Agent = ReturnType<typeof request.agent>;

interface Session {
  agent: Agent;
  csrfToken: string;
}

interface BoardRoom {
  id: string;
  number: string;
  status: string;
}

describe.skipIf(!hasTestDatabase)('housekeeping', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let manager: Session;
  let reception: Session;
  let housekeeper: Session;
  let technician: Session;
  const rooms: Record<string, string> = {};

  function send(session: Session, method: 'post' | 'patch', path: string): request.Test {
    return session.agent[method](`${HOUSEKEEPING}${path}`).set('X-CSRF-Token', session.csrfToken);
  }

  function roomId(number: string): string {
    const id = rooms[number];
    if (id === undefined) {
      throw new Error(`chambre ${number} absente`);
    }
    return id;
  }

  async function statusOf(number: string): Promise<string | undefined> {
    const rows = await harness.rows<{ status: string }>(
      'SELECT housekeeping_status AS status FROM rooms WHERE number = $1',
      [number],
    );
    return rows[0]?.status;
  }

  async function auditCount(number: string): Promise<number> {
    const rows = await harness.rows<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_logs
        WHERE action = 'room.housekeeping_changed' AND entity_id = $1`,
      [roomId(number)],
    );
    return rows[0]?.count ?? 0;
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app();
    manager = await logIn(app, await harness.createStaff('direction'));
    reception = await logIn(app, await harness.createStaff('reception'));
    housekeeper = await logIn(app, await harness.createStaff('housekeeping'));
    technician = await logIn(app, await harness.createStaff('technician'));

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en,
         area_sqm, max_occupancy, base_occupancy, base_price_cents)
       VALUES ('menage-double', 'Double ménage', 'Housekeeping double', 'D', 'D', 'L', 'B',
               18, 2, 2, 9000)`,
    );
    const inserted = await harness.rows<{ id: string; number: string }>(
      `INSERT INTO rooms (number, floor, category_id, housekeeping_status, is_active)
       SELECT v.number, 7, c.id, v.status, v.active
         FROM room_categories c,
              (VALUES ('H701', 'dirty', true), ('H702', 'dirty', true),
                      ('H703', 'clean', true), ('H704', 'dirty', false))
                AS v (number, status, active)
        WHERE c.code = 'menage-double'
       RETURNING id, number`,
    );
    for (const room of inserted) {
      rooms[room.number] = room.id;
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('board', () => {
    it('lists the active rooms of a floor with their state, never cached', async () => {
      const response = await housekeeper.agent.get(`${HOUSEKEEPING}/rooms?floor=7`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const items = response.body.items as BoardRoom[];
      // The deactivated room H704 is not part of the housekeeping.
      expect(items.map((room) => `${room.number}:${room.status}`)).toEqual([
        'H701:dirty',
        'H702:dirty',
        'H703:clean',
      ]);
      expect(items[0]).toEqual({
        id: roomId('H701'),
        number: 'H701',
        floor: 7,
        categoryCode: 'menage-double',
        categoryName: 'Double ménage',
        status: 'dirty',
      });
      expect(typeof response.body.summary.total).toBe('number');
      expect(response.body.summary.dirty).toBeGreaterThanOrEqual(2);
    });

    it('filters the rooms to be cleaned', async () => {
      const response = await reception.agent.get(`${HOUSEKEEPING}/rooms?floor=7&status=dirty`);
      const numbers = (response.body.items as BoardRoom[]).map((room) => room.number);
      expect(numbers).toEqual(['H701', 'H702']);
    });

    it('stays closed to technicians and to visitors without a session', async () => {
      expect((await technician.agent.get(`${HOUSEKEEPING}/rooms`)).status).toBe(403);
      expect((await request(app).get(`${HOUSEKEEPING}/rooms`)).status).toBe(401);
    });
  });

  describe('changes', () => {
    it('lets housekeeping mark a room clean, and writes it to the audit log', async () => {
      const response = await send(housekeeper, 'patch', `/rooms/${roomId('H701')}`).send({
        status: 'clean',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('clean');
      expect(await statusOf('H701')).toBe('clean');
      const rows = await harness.rows<{ changes: unknown }>(
        `SELECT changes FROM audit_logs
          WHERE action = 'room.housekeeping_changed' AND entity_id = $1`,
        [roomId('H701')],
      );
      expect(rows.map((row) => row.changes)).toEqual([
        { housekeepingStatus: { from: 'dirty', to: 'clean' } },
      ]);
    });

    it('writes nothing when the room is already in that state', async () => {
      const response = await send(housekeeper, 'patch', `/rooms/${roomId('H701')}`).send({
        status: 'clean',
      });
      expect(response.status).toBe(200);
      expect(await auditCount('H701')).toBe(1);
    });

    it('lets the reception mark a room to be cleaned, but not clean', async () => {
      const dirty = await send(reception, 'patch', `/rooms/${roomId('H703')}`).send({
        status: 'dirty',
      });
      expect(dirty.status).toBe(200);
      expect(await statusOf('H703')).toBe('dirty');

      const clean = await send(reception, 'patch', `/rooms/${roomId('H703')}`).send({
        status: 'clean',
      });
      expect(clean.status).toBe(403);
      expect(clean.body.code).toBe('HOUSEKEEPING_STATUS_FORBIDDEN');
      expect(await statusOf('H703')).toBe('dirty');
    });

    it('refuses a change without the anti-CSRF token', async () => {
      const path = `${HOUSEKEEPING}/rooms/${roomId('H702')}`;
      const response = await housekeeper.agent.patch(path).send({ status: 'clean' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('refuses a deactivated or unknown room, and an unknown state', async () => {
      const inactive = await send(manager, 'patch', `/rooms/${roomId('H704')}`).send({
        status: 'clean',
      });
      expect(inactive.status).toBe(404);
      expect(await statusOf('H704')).toBe('dirty');

      const unknown = await send(manager, 'patch', `/rooms/${UNKNOWN_ID}`).send({
        status: 'clean',
      });
      expect(unknown.status).toBe(404);

      const state = await send(manager, 'patch', `/rooms/${roomId('H702')}`).send({
        status: 'inspected',
      });
      expect(state.status).toBe(400);
      expect(state.body.errors[0].field).toBe('status');
    });
  });

  describe('grouped changes', () => {
    it('changes several rooms at once, all or nothing', async () => {
      const refused = await send(housekeeper, 'post', '/rooms/status').send({
        roomIds: [roomId('H702'), roomId('H704')],
        status: 'clean',
      });
      expect(refused.status).toBe(404);
      // The valid room was not changed either.
      expect(await statusOf('H702')).toBe('dirty');

      const response = await send(housekeeper, 'post', '/rooms/status').send({
        roomIds: [roomId('H702'), roomId('H703'), roomId('H701')],
        status: 'clean',
      });
      expect(response.status).toBe(200);
      // H701 was already clean: two rooms really changed.
      expect(response.body.changed).toBe(2);
      const states = (response.body.items as BoardRoom[]).map((room) => room.status);
      expect(states).toEqual(['clean', 'clean', 'clean']);
    });

    it('refuses an empty list', async () => {
      const response = await send(manager, 'post', '/rooms/status').send({
        roomIds: [],
        status: 'dirty',
      });
      expect(response.status).toBe(400);
      expect(response.body.errors[0].field).toBe('roomIds');
    });
  });
});
