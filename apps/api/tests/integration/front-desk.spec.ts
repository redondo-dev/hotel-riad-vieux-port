import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * The front desk against the test database: the arrivals and departures of a day, the arrival
 * (room given, in service, clean or accepted dirty), the departure (room to be cleaned) and the
 * no-show with its fee (RM-17). Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 1 (rooms A1xx), the category « accueil-double », the references
 * « ACCU… » and September 2034, with the clock fixed on 10 September 2034.
 */

const TODAY = '2034-09-10';

type Session = Awaited<ReturnType<typeof logIn>>;
type Response = request.Response;

interface Item {
  id: string;
  reference: string;
  status: string;
  version: number;
  customerName: string;
  late: boolean;
  rooms: { room: { number: string; housekeepingStatus: string } | null }[];
}

interface Day {
  arrivals: { total: number; done: number; items: Item[] };
  departures: { total: number; done: number; items: Item[] };
}

/** The other files leave confirmed stays in the past, listed late as well: set aside here. */
function ours(items: Item[]): Item[] {
  return items.filter((stay) => stay.reference.startsWith('ACCU'));
}

describe.skipIf(!hasTestDatabase)('front desk', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let reception: Session;
  let housekeeper: Session;

  function send(path: string): request.Test {
    return reception.agent.post(`${ADMIN}${path}`).set('X-CSRF-Token', reception.csrfToken);
  }

  async function day(): Promise<Day> {
    const response = await reception.agent.get(`${ADMIN}/front-desk?date=${TODAY}`);
    return response.body as Day;
  }

  async function item(reference: string): Promise<Item> {
    const { arrivals, departures } = await day();
    const found = [...arrivals.items, ...departures.items].find((stay) => {
      return stay.reference === reference;
    });
    if (found === undefined) {
      throw new Error(`${reference} absent de la liste du jour`);
    }
    return found;
  }

  async function act(reference: string, action: string, body: object = {}): Promise<Response> {
    const stay = await item(reference);
    return send(`/reservations/${stay.id}/${action}`)
      .set('If-Match', `"${stay.version}"`)
      .send(body);
  }

  async function roomStatus(number: string): Promise<string | undefined> {
    const rows = await harness.rows<{ status: string }>(
      'SELECT housekeeping_status AS status FROM rooms WHERE number = $1',
      [number],
    );
    return rows[0]?.status;
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app({ today: () => TODAY });
    reception = await logIn(app, await harness.createStaff('reception'));
    housekeeper = await logIn(app, await harness.createStaff('housekeeping'));

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents)
       VALUES ('accueil-double', 'Double accueil', 'Double', 'D', 'D', 'L', 'B', 18, 2, 2, 9000)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id, housekeeping_status)
       SELECT v.number, 1, c.id, v.status
         FROM room_categories c,
              (VALUES ('A101', 'clean'), ('A102', 'dirty'), ('A103', 'clean'))
                AS v (number, status)
        WHERE c.code = 'accueil-double'`,
    );
    await harness.execute(
      `INSERT INTO customers (first_name, last_name, email)
       VALUES ('Inès', 'Accueil', 'accueil-ines@test.example')`,
    );
    // ACCU0001 arrives today (A101, clean); ACCU0002 arrives today (A102, dirty); ACCU0003
    // arrives today without a room; ACCU0004 leaves today (A103); ACCU0005 was expected
    // yesterday and never came.
    await harness.execute(
      `INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                                 rate_plan, total_amount_cents, free_cancellation_until)
       SELECT v.reference, c.id, 'desk', v.check_in::date, v.check_out::date, v.status,
              'flexible', 19000, '2034-09-01T10:00:00Z'
         FROM customers c,
              (VALUES ('ACCU0001', '2034-09-10', '2034-09-12', 'confirmed'),
                      ('ACCU0002', '2034-09-10', '2034-09-12', 'confirmed'),
                      ('ACCU0003', '2034-09-10', '2034-09-11', 'confirmed'),
                      ('ACCU0004', '2034-09-08', '2034-09-10', 'checked_in'),
                      ('ACCU0005', '2034-09-09', '2034-09-11', 'confirmed'))
                AS v (reference, check_in, check_out, status)
        WHERE c.email = 'accueil-ines@test.example'`,
    );
    await harness.execute(
      `INSERT INTO reservation_rooms (reservation_id, category_id, room_id, adults,
                                      subtotal_cents)
       SELECT r.id, k.id, m.id, 2, 19000
         FROM reservations r
         JOIN room_categories k ON k.code = 'accueil-double'
         LEFT JOIN rooms m ON m.number = CASE r.reference
                                           WHEN 'ACCU0001' THEN 'A101'
                                           WHEN 'ACCU0002' THEN 'A102'
                                           WHEN 'ACCU0004' THEN 'A103'
                                         END
        WHERE r.reference LIKE 'ACCU%'`,
    );
    // ACCU0005: 95 € the first night, 95 € the second.
    await harness.execute(
      `INSERT INTO reservation_nights (reservation_room_id, night, price_cents)
       SELECT l.id, n.night::date, 9500
         FROM reservation_rooms l
         JOIN reservations r ON r.id = l.reservation_id,
              (VALUES ('2034-09-09'), ('2034-09-10')) AS n (night)
        WHERE r.reference = 'ACCU0005'`,
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  it('is for the reception and the management only', async () => {
    expect((await request(app).get(`${ADMIN}/front-desk`)).status).toBe(401);
    expect((await housekeeper.agent.get(`${ADMIN}/front-desk`)).status).toBe(403);
  });

  it('lists the arrivals and departures of the day, the late arrival apart', async () => {
    const { arrivals, departures } = await day();
    const expected = ours(arrivals.items);
    expect(expected.map((stay) => stay.reference)).toEqual([
      'ACCU0005',
      'ACCU0001',
      'ACCU0002',
      'ACCU0003',
    ]);
    expect(expected[0]?.late).toBe(true);
    // The counters cover the day only (this file owns September 2034).
    expect([arrivals.total, arrivals.done]).toEqual([3, 0]);
    const leaving = ours(departures.items);
    expect(leaving.map((stay) => stay.reference)).toEqual(['ACCU0004']);
    expect(leaving[0]?.customerName).toBe('Accueil Inès');
  });

  it('records an arrival with the version read, a given room and the checks', async () => {
    const stay = await item('ACCU0001');
    const missing = await send(`/reservations/${stay.id}/check-in`).send({});
    expect(missing.status).toBe(428);

    const arrived = await act('ACCU0001', 'check-in', { identityChecked: true });
    expect(arrived.status).toBe(200);
    expect(arrived.body.status).toBe('checked_in');

    const stale = await send(`/reservations/${stay.id}/check-in`)
      .set('If-Match', `"${stay.version}"`)
      .send({});
    expect(stale.status).toBe(412);
    expect((await day()).arrivals.done).toBe(1);
  });

  it('refuses a stay without a room, and a dirty room unless accepted', async () => {
    const unassigned = await act('ACCU0003', 'check-in');
    expect(unassigned.status).toBe(409);
    expect(unassigned.body.code).toBe('ROOM_NOT_ASSIGNED');

    const dirty = await act('ACCU0002', 'check-in');
    expect(dirty.body.code).toBe('ROOM_DIRTY');
    expect(dirty.body.detail).toContain('A102');

    const accepted = await act('ACCU0002', 'check-in', { acceptDirtyRoom: true });
    expect(accepted.body.status).toBe('checked_in');
    const audit = await harness.rows<{ changes: Record<string, unknown> }>(
      `SELECT changes FROM audit_logs
        WHERE entity_id = $1 AND action = 'reservation.checked_in'`,
      [accepted.body.id],
    );
    expect(audit[0]?.changes['dirtyRoomsAccepted']).toEqual(['A102']);
  });

  it('records a departure: the room is to be cleaned', async () => {
    expect(await roomStatus('A103')).toBe('clean');
    const left = await act('ACCU0004', 'check-out');
    expect(left.status).toBe(200);
    expect(left.body.status).toBe('checked_out');
    expect(await roomStatus('A103')).toBe('dirty');
    expect((await day()).departures.done).toBe(1);
  });

  it('declares a no-show from the day after the arrival, with the first night due', async () => {
    const tooEarly = await act('ACCU0003', 'no-show');
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('RESERVATION_STATE');

    const noShow = await act('ACCU0005', 'no-show');
    expect(noShow.status).toBe(200);
    expect(noShow.body.status).toBe('no_show');
    expect(noShow.body.cancellationFeeCents).toBe(9500);
  });
});
