import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * The planning of the rooms against the test database: stays placed on their room, stays to
 * assign, rooms out of service, cancelled stays left out, guests' names hidden from housekeeping
 * and technicians, period checked, time of a month. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 2 (rooms L2xx), the categories « plan-… », the references « PLAN… » and
 * July 2034.
 */

const PLANNING = `${ADMIN}/planning`;
const JULY = 'from=2034-07-01&to=2034-07-15';

type Session = Awaited<ReturnType<typeof logIn>>;

interface Stay {
  reference: string;
  adults: number;
  children: number;
  guestName?: string;
}

interface Room {
  number: string;
  stays: Stay[];
  blocks: { from: string; to: string | null; reason: string; incident: unknown }[];
}

interface Category {
  code: string;
  rooms: Room[];
  unassigned: Stay[];
}

describe.skipIf(!hasTestDatabase)('planning of the rooms', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let reception: Session;
  let housekeeper: Session;
  let technician: Session;

  function category(response: request.Response, code: string): Category | undefined {
    return (response.body.categories as Category[]).find((item) => item.code === code);
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app();
    reception = await logIn(app, await harness.createStaff('reception'));
    housekeeper = await logIn(app, await harness.createStaff('housekeeping'));
    technician = await logIn(app, await harness.createStaff('technician'));

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents)
       VALUES ('plan-double', 'Double planning', 'Double', 'D', 'D', 'L', 'B', 18, 3, 2, 9000),
              ('plan-vide', 'Sans chambre', 'Empty', 'D', 'D', 'L', 'B', 18, 2, 2, 9000)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id, is_active)
       SELECT v.number, 2, c.id, v.active
         FROM room_categories c,
              (VALUES ('L201', true), ('L202', true), ('L203', false)) AS v (number, active)
        WHERE c.code = 'plan-double'`,
    );
    // L202 out of service from 12 July, end unknown.
    await harness.execute(
      `INSERT INTO room_blocks (room_id, period, reason)
       SELECT id, daterange('2034-07-12', NULL, '[)'), 'maintenance' FROM rooms
        WHERE number = 'L202'`,
    );
    await harness.execute(
      `INSERT INTO customers (first_name, last_name, email)
       VALUES ('Claire', 'Planning', 'plan-claire@test.example')`,
    );
    // Placed on L201; to assign; cancelled; after the period.
    await harness.execute(
      `INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                                 rate_plan, total_amount_cents, free_cancellation_until,
                                 cancelled_at)
       SELECT v.reference, c.id, 'desk', v.check_in::date, v.check_out::date, v.status,
              'flexible', 0, '2034-07-01T13:00:00Z',
              CASE WHEN v.status = 'cancelled' THEN now() END
         FROM customers c,
              (VALUES ('PLAN0001', '2034-07-10', '2034-07-12', 'confirmed'),
                      ('PLAN0002', '2034-07-11', '2034-07-13', 'confirmed'),
                      ('PLAN0003', '2034-07-10', '2034-07-12', 'cancelled'),
                      ('PLAN0004', '2034-07-20', '2034-07-22', 'confirmed'))
                AS v (reference, check_in, check_out, status)
        WHERE c.email = 'plan-claire@test.example'`,
    );
    await harness.execute(
      `INSERT INTO reservation_rooms (reservation_id, category_id, room_id, adults,
                                      children_ages, subtotal_cents)
       SELECT r.id, k.id,
              CASE WHEN r.reference = 'PLAN0001' THEN m.id END,
              2, CASE WHEN r.reference = 'PLAN0001' THEN '{6}'::smallint[] ELSE '{}' END, 0
         FROM reservations r, room_categories k, rooms m
        WHERE r.reference LIKE 'PLAN%' AND k.code = 'plan-double' AND m.number = 'L201'`,
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  it('requires a staff session', async () => {
    expect((await request(app).get(`${PLANNING}?${JULY}`)).status).toBe(401);
  });

  it('places each stay on its room, and lists the stays still to assign', async () => {
    const response = await reception.agent.get(`${PLANNING}?${JULY}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.from).toBe('2034-07-01');

    const double = category(response, 'plan-double');
    // L203 is deactivated and holds no stay: not shown.
    expect(double?.rooms.map((room) => room.number)).toEqual(['L201', 'L202']);
    const [first, second] = double?.rooms ?? [];
    // The cancelled stay and the stay after the period are left out.
    expect(first?.stays).toEqual([
      expect.objectContaining({
        reference: 'PLAN0001',
        adults: 2,
        children: 1,
        guestName: 'Planning C.',
      }),
    ]);
    expect(second?.blocks).toEqual([
      { from: '2034-07-12', to: null, reason: 'maintenance', incident: null },
    ]);
    expect(double?.unassigned.map((stay) => stay.reference)).toEqual(['PLAN0002']);
    // A category without any room has nothing to plan.
    expect(category(response, 'plan-vide')).toBeUndefined();
  });

  it('hides the guests’ names from housekeeping and technicians', async () => {
    for (const session of [housekeeper, technician]) {
      const response = await session.agent.get(`${PLANNING}?${JULY}`);
      expect(response.status).toBe(200);
      const stay = category(response, 'plan-double')?.rooms[0]?.stays[0];
      expect(stay?.reference).toBe('PLAN0001');
      expect(stay !== undefined && 'guestName' in stay).toBe(false);
    }
  });

  it('refuses a period ending before it starts, or longer than 31 days', async () => {
    const reversed = await reception.agent.get(`${PLANNING}?from=2034-07-15&to=2034-07-01`);
    expect(reversed.status).toBe(400);
    const tooLong = await reception.agent.get(`${PLANNING}?from=2034-07-01&to=2034-08-01`);
    expect(tooLong.status).toBe(400);
    expect((await reception.agent.get(PLANNING)).status).toBe(400);
  });

  it('answers a month of the whole hotel in less than one second', async () => {
    const started = performance.now();
    const response = await reception.agent.get(`${PLANNING}?from=2034-07-01&to=2034-07-31`);
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
