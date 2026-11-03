import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, IdentityHarness, logIn } from '../support/identity-harness.ts';
import { hasTestDatabase } from '../support/test-database.ts';

/**
 * Changes of reservations against the test database: dates and guests with a price preview,
 * optimistic lock (If-Match), rights of the non-refundable rate, room selector and room given
 * (probes P3 and P4), cancellation and its fee. Skipped without TEST_DATABASE_URL.
 *
 * This file owns floor 3 (rooms M3xx), the categories « modif-… », the e-mails « modif-… »,
 * April and June 2034, with the clock fixed on 1 April 2034 at 10:00 in Marseille.
 */

const RESERVATIONS = `${ADMIN}/reservations`;
const TODAY = '2034-04-01';
const NOW = new Date('2034-04-01T08:00:00Z');

type Session = Awaited<ReturnType<typeof logIn>>;

interface SavedSettings {
  discount: string;
  tax: number;
}

interface Detail {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  totalCents: number;
  version: number;
  internalNotes: string | null;
  freeCancellationUntil: string | null;
  cancellationFeeCents: number;
  cancelledAt: string | null;
  rooms: { id: string; room: { number: string } | null; adults: number }[];
}

let keyCount = 0;

describe.skipIf(!hasTestDatabase)('changes of reservations', () => {
  let harness: IdentityHarness;
  let app: ReturnType<IdentityHarness['app']>;
  let reception: Session;
  let manager: Session;
  let saved: SavedSettings | undefined;
  const ids: Record<string, string> = {};
  /** The reservations of the tests, by name. */
  const stays: Record<string, Detail> = {};

  function send(session: Session, method: 'post' | 'patch' | 'put', path: string): request.Test {
    return session.agent[method](`${RESERVATIONS}${path}`).set('X-CSRF-Token', session.csrfToken);
  }

  /** Books through the API, family room unless said otherwise. */
  async function book(name: string, changes: object): Promise<Detail> {
    keyCount += 1;
    const response = await send(reception, 'post', '')
      .set('Idempotency-Key', `test-modif-${String(keyCount).padStart(8, '0')}`)
      .send({
        ratePlan: 'flexible',
        source: 'desk',
        rooms: [{ categoryId: ids['modif-famille'], adults: 2 }],
        newCustomer: { firstName: name, lastName: 'Modif', email: `modif-${name}@test.example` },
        ...changes,
      });
    if (response.status !== 201) {
      throw new Error(`réservation ${name} refusée (${response.status}) : ${response.text}`);
    }
    stays[name] = response.body as Detail;
    return stays[name];
  }

  async function current(name: string): Promise<Detail> {
    const response = await reception.agent.get(`${RESERVATIONS}/${stays[name]?.id}`);
    return response.body as Detail;
  }

  async function modify(session: Session, name: string, body: object): Promise<request.Response> {
    const { id, version } = await current(name);
    return send(session, 'patch', `/${id}`).set('If-Match', `"${version}"`).send(body);
  }

  async function giveRoom(name: string, number: string): Promise<request.Response> {
    const stay = await current(name);
    return send(reception, 'put', `/${stay.id}/rooms/${stay.rooms[0]?.id}/room`).send({
      roomId: ids[number],
    });
  }

  beforeAll(async () => {
    harness = new IdentityHarness();
    app = harness.app({ today: () => TODAY, now: () => NOW });
    reception = await logIn(app, await harness.createStaff('reception'));
    manager = await logIn(app, await harness.createStaff('direction'));

    const settings = await harness.rows<SavedSettings>(
      `SELECT non_refundable_discount_pct::text AS discount,
              tourist_tax_cents_per_adult_night AS tax
         FROM hotel_settings WHERE id = 1`,
    );
    saved = settings[0];
    if (saved === undefined) {
      await harness.execute(
        `INSERT INTO hotel_settings (id, name, address, phone, email,
                                     non_refundable_discount_pct, tourist_tax_cents_per_adult_night)
         VALUES (1, 'Hôtel de test', '1 quai de test, 13002 Marseille', '+33465710000',
                 'contact@test.example', 10, 250)`,
      );
    } else {
      await harness.execute(
        `UPDATE hotel_settings
            SET non_refundable_discount_pct = 10, tourist_tax_cents_per_adult_night = 250
          WHERE id = 1`,
      );
    }

    const categories = await harness.rows<{ id: string; code: string }>(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en, area_sqm,
         max_occupancy, base_occupancy, base_price_cents, extra_adult_cents, extra_child_cents)
       VALUES ('modif-famille', 'Famille modif', 'Family', 'D', 'D', 'L', 'B', 25,
               3, 2, 10000, 2500, 1500),
              ('modif-double', 'Double modif', 'Double', 'D', 'D', 'L', 'B', 18,
               2, 2, 8000, 2500, 1500)
       RETURNING id, code`,
    );
    for (const category of categories) {
      ids[category.code] = category.id;
    }
    const rooms = await harness.rows<{ id: string; number: string }>(
      `INSERT INTO rooms (number, floor, category_id, is_active)
       SELECT v.number, 3, c.id, v.active
         FROM room_categories c
         JOIN (VALUES ('M301', 'modif-famille', true), ('M302', 'modif-famille', true),
                      ('M303', 'modif-famille', false), ('M311', 'modif-double', true))
           AS v (number, code, active)
           ON v.code = c.code
       RETURNING id, number`,
    );
    for (const room of rooms) {
      ids[room.number] = room.id;
    }
    // M302 out of service on the night of 11 June only.
    await harness.execute(
      `INSERT INTO room_blocks (room_id, period, reason)
       VALUES ($1, daterange('2034-06-11', '2034-06-12', '[)'), 'maintenance')`,
      [ids['M302']],
    );
    const services = await harness.rows<{ id: string }>(
      `INSERT INTO services (code, name_fr, name_en, unit_price_cents, pricing_unit, vat_rate)
       VALUES ('modif-petit-dejeuner', 'Petit-déjeuner', 'Breakfast', 1400, 'per_person_night', 10)
       RETURNING id`,
    );
    ids['breakfast'] = services[0]?.id ?? '';
  });

  afterAll(async () => {
    if (saved === undefined) {
      await harness.execute('DELETE FROM hotel_settings WHERE id = 1');
    } else {
      await harness.execute(
        `UPDATE hotel_settings
            SET non_refundable_discount_pct = $1::numeric, tourist_tax_cents_per_adult_night = $2
          WHERE id = 1`,
        [saved.discount, saved.tax],
      );
    }
    await harness.close();
  });

  describe('dates, guests and notes', () => {
    beforeAll(async () => {
      // 2 adults and a child of 6, 10 to 12 June, with breakfast: 32 400 cents.
      await book('alice', {
        checkIn: '2034-06-10',
        checkOut: '2034-06-12',
        rooms: [{ categoryId: ids['modif-famille'], adults: 2, childrenAges: [6] }],
        services: [{ serviceId: ids['breakfast'] }],
        internalNotes: 'Arrivée tardive',
      });
    });

    it('requires the version read (If-Match)', async () => {
      const response = await send(reception, 'patch', `/${stays['alice']?.id}`).send({
        checkOut: '2034-06-13',
      });
      expect(response.status).toBe(428);
      expect(response.body.code).toBe('VERSION_REQUIRED');
    });

    it('previews the new price without saving anything', async () => {
      const { id, version } = await current('alice');
      const response = await send(reception, 'patch', `/${id}?preview=true`)
        .set('If-Match', String(version))
        .send({ checkOut: '2034-06-13' });
      expect(response.status).toBe(200);
      // 3 nights at 115 €, breakfast 3 guests × 3 nights, tourist tax 2 adults × 3 nights.
      expect(response.body.previousTotalCents).toBe(32_400);
      expect(response.body.totalCents).toBe(34_500 + 12_600 + 1500);
      expect(response.body.differenceCents).toBe(16_200);
      const after = await current('alice');
      expect(after.checkOut).toBe('2034-06-12');
      expect(after.version).toBe(version);
    });

    it('saves the change, prices the stay again and logs it', async () => {
      const response = await modify(reception, 'alice', { checkOut: '2034-06-13' });
      expect(response.status).toBe(200);
      const detail = response.body as Detail;
      expect(detail.checkOut).toBe('2034-06-13');
      expect(detail.totalCents).toBe(48_600);
      expect(detail.version).toBe(1);
      const audit = await harness.rows<{ action: string }>(
        'SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id',
        [detail.id],
      );
      expect(audit.map((row) => row.action)).toEqual([
        'reservation.created',
        'reservation.updated',
      ]);
    });

    it('refuses a change made on a version already changed by a colleague', async () => {
      const response = await send(reception, 'patch', `/${stays['alice']?.id}`)
        .set('If-Match', '"0"')
        .send({ checkOut: '2034-06-14' });
      expect(response.status).toBe(412);
      expect(response.body.code).toBe('RESERVATION_CHANGED');
      expect(response.body.detail).toContain('par Test reception');
    });

    it('refuses more guests than the room holds, and empties a note', async () => {
      const stay = await current('alice');
      const tooMany = await modify(reception, 'alice', {
        rooms: [{ lineId: stay.rooms[0]?.id, adults: 2, childrenAges: [6, 8] }],
      });
      expect(tooMany.status).toBe(400);

      const emptied = await modify(reception, 'alice', { internalNotes: '' });
      expect(emptied.status).toBe(200);
      expect((emptied.body as Detail).internalNotes).toBeNull();
    });

    it('lets only the management change a non-refundable stay, with a reason (RM-18)', async () => {
      await book('bruno', {
        ratePlan: 'non_refundable',
        checkIn: '2034-06-20',
        checkOut: '2034-06-22',
      });
      const byReception = await modify(reception, 'bruno', { checkOut: '2034-06-23' });
      expect(byReception.status).toBe(403);
      expect(byReception.body.code).toBe('MANAGEMENT_ONLY');

      const withoutReason = await modify(manager, 'bruno', { checkOut: '2034-06-23' });
      expect(withoutReason.status).toBe(400);
      expect(withoutReason.body.errors[0].field).toBe('reason');

      const granted = await modify(manager, 'bruno', {
        checkOut: '2034-06-23',
        reason: 'Geste commercial',
      });
      expect(granted.status).toBe(200);
      expect((granted.body as Detail).checkOut).toBe('2034-06-23');
    });
  });

  describe('room given', () => {
    it('offers only the free rooms in service of the category (probes P3, P4)', async () => {
      const stay = await current('alice');
      const response = await reception.agent.get(
        `${RESERVATIONS}/${stay.id}/rooms/${stay.rooms[0]?.id}/free-rooms`,
      );
      expect(response.status).toBe(200);
      // M302 is out of service on 11 June, M303 is deactivated, M311 is a double.
      const numbers = (response.body.items as { number: string }[]).map((room) => room.number);
      expect(numbers).toEqual(['M301']);
    });

    it('refuses a deactivated room, a room out of service and another category', async () => {
      const inactive = await giveRoom('alice', 'M303');
      expect(inactive.body.code).toBe('ROOM_INACTIVE');
      const outOfService = await giveRoom('alice', 'M302');
      expect(outOfService.body.code).toBe('ROOM_OUT_OF_SERVICE');
      const double = await giveRoom('alice', 'M311');
      expect(double.status).toBe(400);
    });

    it('gives a free room; the next guest may have it from the departure day (RM-01)', async () => {
      const given = await giveRoom('alice', 'M301');
      expect(given.status).toBe(200);
      expect((given.body as Detail).rooms[0]?.room?.number).toBe('M301');

      await book('chloe', { checkIn: '2034-06-13', checkOut: '2034-06-15' });
      expect((await giveRoom('chloe', 'M301')).status).toBe(200);
    });

    it('refuses a room already given on one of the nights', async () => {
      await book('david', { checkIn: '2034-06-12', checkOut: '2034-06-14' });
      const response = await giveRoom('david', 'M301');
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ROOM_ALREADY_ASSIGNED');
    });

    it('refuses new dates on which the room given is not free', async () => {
      const response = await modify(reception, 'alice', {
        checkIn: '2034-06-14',
        checkOut: '2034-06-15',
      });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ROOM_NOT_FREE');
      expect(response.body.detail).toContain('M301');
    });
  });

  describe('cancellation', () => {
    it('is free before the deadline of the flexible rate (RM-15)', async () => {
      const path = `${RESERVATIONS}/${stays['alice']?.id}/cancellation`;
      const response = await reception.agent.get(path);
      expect(response.status).toBe(200);
      expect(response.body.feeCents).toBe(0);
      expect(response.body.managementOnly).toBe(false);
    });

    it('charges the first night after the deadline, and frees the room', async () => {
      // Arrival tomorrow: the 48 hours are over.
      const late = await book('emma', { checkIn: '2034-04-02', checkOut: '2034-04-04' });
      const response = await send(reception, 'post', `/${late.id}/cancel`).send({
        reason: 'Client malade',
      });
      expect(response.status).toBe(200);
      const detail = response.body as Detail;
      expect(detail.status).toBe('cancelled');
      expect(detail.cancellationFeeCents).toBe(10_000);
      expect(detail.cancelledAt).not.toBeNull();
      const active = await harness.rows<{ active: boolean }>(
        'SELECT is_active AS active FROM reservation_rooms WHERE reservation_id = $1',
        [late.id],
      );
      expect(active.map((row) => row.active)).toEqual([false]);
    });

    it('lets only the management waive the fee', async () => {
      const late = await book('farid', { checkIn: '2034-04-02', checkOut: '2034-04-03' });
      const byReception = await send(reception, 'post', `/${late.id}/cancel`).send({
        reason: 'Geste',
        waiveFee: true,
      });
      expect(byReception.status).toBe(403);
      const byManager = await send(manager, 'post', `/${late.id}/cancel`).send({
        reason: 'Geste',
        waiveFee: true,
      });
      expect((byManager.body as Detail).cancellationFeeCents).toBe(0);
    });

    it('keeps every night due at the non-refundable rate, cancelled by management', async () => {
      const id = stays['bruno']?.id;
      const byReception = await send(reception, 'post', `/${id}/cancel`).send({ reason: 'Annulé' });
      expect(byReception.body.code).toBe('MANAGEMENT_ONLY');
      const byManager = await send(manager, 'post', `/${id}/cancel`).send({ reason: 'Annulé' });
      // 3 nights at 90 € (non-refundable rate), after the change of dates above.
      expect((byManager.body as Detail).cancellationFeeCents).toBe(27_000);
    });

    it('refuses to cancel twice, or without a reason', async () => {
      const id = stays['emma']?.id;
      const again = await send(reception, 'post', `/${id}/cancel`).send({ reason: 'Encore' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('RESERVATION_STATE');
      const noReason = await send(reception, 'post', `/${stays['chloe']?.id}/cancel`).send({});
      expect(noReason.status).toBe(400);
    });
  });
});
