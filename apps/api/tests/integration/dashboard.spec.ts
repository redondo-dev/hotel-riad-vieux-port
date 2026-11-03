import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * The dashboard against the test database. The other files leave rooms and stays in the same
 * database, so the figures are compared before and after the data of this file is added: the
 * differences are exact. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 9 (rooms T901 and T902), the category « tdb-double », the references
 * « TDB… », February and March 2035, with the clock fixed on 10 March 2035.
 */

const TODAY = '2035-03-10';

type Session = Awaited<ReturnType<typeof logIn>>;

interface Month {
  month: string;
  roomNightsAvailable: number;
  roomNightsSold: number;
  nightsRevenueCents: number;
  feesCents: number;
}

interface Dashboard {
  today: {
    roomsInService: number;
    roomsSold: number;
    arrivals: { total: number; done: number };
  };
  month: Month;
  previousMonth: Month;
  incidents: { open: number; urgent: number };
}

describe.skipIf(!hasTestDatabase)('dashboard', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let manager: Session;
  let reception: Session;
  let before: Dashboard;

  async function read(): Promise<Dashboard> {
    const response = await manager.agent.get(`${ADMIN}/dashboard`);
    expect(response.status).toBe(200);
    return response.body as Dashboard;
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app({ today: () => TODAY });
    const managerAccount = await harness.createStaff('direction');
    manager = await logIn(app, managerAccount);
    reception = await logIn(app, await harness.createStaff('reception'));
    before = await read();

    await harness.execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents)
       VALUES ('tdb-double', 'Double tableau', 'Double', 'D', 'D', 'L', 'B', 18, 2, 2, 10000)`,
    );
    await harness.execute(
      `INSERT INTO rooms (number, floor, category_id)
       SELECT v.number, 9, c.id
         FROM room_categories c, (VALUES ('T901'), ('T902')) AS v (number)
        WHERE c.code = 'tdb-double'`,
    );
    // T902 out of service the nights of 15 and 16 March.
    await harness.execute(
      `INSERT INTO room_blocks (room_id, period, reason)
       SELECT id, daterange('2035-03-15', '2035-03-17', '[)'), 'maintenance' FROM rooms
        WHERE number = 'T902'`,
    );
    await harness.execute(
      `INSERT INTO customers (first_name, last_name, email)
       VALUES ('Léon', 'Tableau', 'tdb-leon@test.example')`,
    );
    // TDB00001: 10 → 12 March on T901 (2 × 100 €); TDB00002: cancelled with a fee of 50 €;
    // TDB00003: 27 February → 2 March on T902 (3 × 80 €, across the two months).
    await harness.execute(
      `INSERT INTO reservations (reference, customer_id, source, check_in, check_out, status,
                                 rate_plan, total_amount_cents, free_cancellation_until,
                                 cancelled_at, cancellation_fee_cents)
       SELECT v.reference, c.id, 'desk', v.check_in::date, v.check_out::date, v.status,
              'flexible', 0, '2035-01-01T00:00:00Z',
              CASE WHEN v.status = 'cancelled' THEN now() END, v.fee
         FROM customers c,
              (VALUES ('TDB00001', '2035-03-10', '2035-03-12', 'confirmed', 0),
                      ('TDB00002', '2035-03-20', '2035-03-21', 'cancelled', 5000),
                      ('TDB00003', '2035-02-27', '2035-03-02', 'confirmed', 0))
                AS v (reference, check_in, check_out, status, fee)
        WHERE c.email = 'tdb-leon@test.example'`,
    );
    await harness.execute(
      `INSERT INTO reservation_rooms (reservation_id, category_id, room_id, adults,
                                      subtotal_cents)
       SELECT r.id, k.id, m.id, 2, 0
         FROM reservations r
         JOIN room_categories k ON k.code = 'tdb-double'
         JOIN rooms m ON m.number = CASE r.reference WHEN 'TDB00003' THEN 'T902' ELSE 'T901' END
        WHERE r.reference LIKE 'TDB%'`,
    );
    await harness.execute(
      `INSERT INTO reservation_nights (reservation_room_id, night, price_cents)
       SELECT l.id, n.night::date, CASE r.reference WHEN 'TDB00003' THEN 8000 ELSE 10000 END
         FROM reservation_rooms l
         JOIN reservations r ON r.id = l.reservation_id
         JOIN LATERAL generate_series(r.check_in, r.check_out - 1, interval '1 day') AS n (night)
           ON true
        WHERE r.reference IN ('TDB00001', 'TDB00003')`,
    );
    await harness.execute(
      `INSERT INTO incidents (location, title, description, priority, reported_by)
       SELECT 'Ascenseur', 'Ascenseur bloqué', 'Arrêté entre deux étages.', 'urgent', id
         FROM users WHERE email = $1`,
      [managerAccount.email],
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  it('is for the management only', async () => {
    expect((await request(app).get(`${ADMIN}/dashboard`)).status).toBe(401);
    expect((await reception.agent.get(`${ADMIN}/dashboard`)).status).toBe(403);
  });

  it('counts the rooms of the night and the arrivals of the day', async () => {
    const after = await read();
    expect(after.today.roomsInService - before.today.roomsInService).toBe(2);
    expect(after.today.roomsSold - before.today.roomsSold).toBe(1);
    expect(after.today.arrivals.total - before.today.arrivals.total).toBe(1);
  });

  it('adds up the month night by night, and keeps the previous month apart', async () => {
    const after = await read();
    expect(after.month.month).toBe('2035-03');
    // 2 rooms × 31 nights, but T902 out of service 2 nights.
    expect(after.month.roomNightsAvailable - before.month.roomNightsAvailable).toBe(60);
    // 2 nights of TDB00001 and 1 of TDB00003; the cancelled stay holds nothing.
    expect(after.month.roomNightsSold - before.month.roomNightsSold).toBe(3);
    expect(after.month.nightsRevenueCents - before.month.nightsRevenueCents).toBe(28_000);
    expect(after.month.feesCents - before.month.feesCents).toBe(5000);

    const [february, februaryBefore] = [after.previousMonth, before.previousMonth];
    expect(february.month).toBe('2035-02');
    // 2 rooms × 28 nights; 2 nights of TDB00003 in February.
    expect(february.roomNightsAvailable - februaryBefore.roomNightsAvailable).toBe(56);
    expect(february.roomNightsSold - februaryBefore.roomNightsSold).toBe(2);
  });

  it('counts the incidents still open, the urgent ones apart', async () => {
    const after = await read();
    expect(after.incidents.open - before.incidents.open).toBe(1);
    expect(after.incidents.urgent - before.incidents.urgent).toBe(1);
  });
});
