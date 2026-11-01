import { QueryTypes, type Sequelize } from 'sequelize';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, createApp } from '../../src/app.ts';
import { createSequelize } from '../../src/shared/infrastructure/database.ts';
import { createLogger } from '../../src/shared/infrastructure/logger.ts';
import { hasTestDatabase, testDatabaseUrl } from '../support/test-database.ts';

/**
 * Public catalogue against the test database (emptied before each run by global-setup.ts).
 * « Today » is fixed to 10 January 2030 so that the « from » prices do not depend on the date
 * the tests run. Skipped without TEST_DATABASE_URL.
 *
 * Note for the other test files: this one owns the rate periods of January–February 2030.
 */

const PUBLIC = `${API_PREFIX}/public`;
const TODAY = '2030-01-10';

interface CategoryBody {
  code: string;
  roomCount: number;
  fromPriceCents: number;
  [key: string]: unknown;
}

describe.skipIf(!hasTestDatabase)('public catalogue', () => {
  let sequelize: Sequelize;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    sequelize = createSequelize(testDatabaseUrl);
    app = createApp({
      logger: createLogger({ level: 'silent', pretty: false }),
      allowedOrigins: [],
      trustProxy: 0,
      checkDatabase: async () => undefined,
      public: { sequelize, today: () => TODAY },
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  async function execute(sql: string, bind: unknown[] = []): Promise<void> {
    await sequelize.query(sql, { bind });
  }

  async function categoryId(code: string): Promise<string> {
    const rows = await sequelize.query<{ id: string }>(
      'SELECT id FROM room_categories WHERE code = $1',
      { bind: [code], type: QueryTypes.SELECT },
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`catégorie ${code} absente`);
    }
    return id;
  }

  async function insertCategory(
    code: string,
    options: { basePriceCents: number; sortOrder: number; isActive?: boolean },
  ): Promise<string> {
    await execute(
      `INSERT INTO room_categories (
         code, name_fr, name_en, description_fr, description_en, beds_fr, beds_en,
         area_sqm, max_occupancy, base_occupancy, base_price_cents, amenities, sort_order,
         is_active)
       VALUES ($1, $2, $3, 'Description FR', 'Description EN', '1 lit double', '1 double bed',
               20, 3, 2, $4, '{wifi,shower}', $5, $6)`,
      [
        code,
        `Nom ${code}`,
        `Name ${code}`,
        options.basePriceCents,
        options.sortOrder,
        options.isActive ?? true,
      ],
    );
    return categoryId(code);
  }

  async function insertRoom(number: string, category: string, isActive = true): Promise<void> {
    await execute(
      'INSERT INTO rooms (number, floor, category_id, is_active) VALUES ($1, 9, $2, $3)',
      [number, category, isActive],
    );
  }

  describe('while the hotel is not configured', () => {
    it('answers 503 with a stable code, and nothing is cached', async () => {
      for (const path of ['/hotel', '/room-categories']) {
        const response = await request(app).get(`${PUBLIC}${path}`);
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('HOTEL_NOT_CONFIGURED');
        expect(String(response.headers['cache-control'] ?? '').includes('public')).toBe(false);
      }
    });
  });

  describe('with a catalogue', () => {
    beforeAll(async () => {
      await execute(
        `INSERT INTO hotel_settings (id, name, address, phone, email, online_booking_horizon_days)
         VALUES (1, 'Hôtel de test', '1 quai de test, 13002 Marseille', '+33465710000',
                 'contact@test.example', 30)`,
      );

      const harbour = await insertCategory('test-vue-port', {
        basePriceCents: 10_000,
        sortOrder: 1,
      });
      const courtyard = await insertCategory('test-patio', { basePriceCents: 8000, sortOrder: 2 });
      const closed = await insertCategory('test-fermee', {
        basePriceCents: 9000,
        sortOrder: 3,
        isActive: false,
      });
      await insertCategory('test-sans-chambre', { basePriceCents: 9000, sortOrder: 4 });

      await insertRoom('T901', harbour);
      await insertRoom('T902', harbour);
      await insertRoom('T903', harbour, false);
      await insertRoom('T904', courtyard);
      await insertRoom('T905', closed);

      // +20 % for every category all over the window, -50 % for one category on 2 nights:
      // the event of the category wins over the season (RM-09).
      await execute(
        `INSERT INTO rate_periods (name, kind, period, adjustment_pct, category_id) VALUES
           ('Saison de test', 'season', daterange('2030-01-01', '2030-03-01', '[)'), 20, NULL),
           ('Événement de test', 'event', daterange('2030-01-20', '2030-01-22', '[)'), -50, $1)`,
        [harbour],
      );

      await execute(
        `INSERT INTO services (code, name_fr, name_en, unit_price_cents, pricing_unit, vat_rate,
                               bookable_online, is_active) VALUES
           ('test-petit-dejeuner', 'Petit-déjeuner', 'Breakfast', 1400, 'per_person_night', 10,
            true, true),
           ('test-parking', 'Parking', 'Car park', 2000, 'per_night', 20, false, true),
           ('test-ancien', 'Ancien service', 'Old service', 500, 'per_stay', 20, true, false)`,
      );
    });

    it('GET /hotel gives the hotel information and the online booking rules', async () => {
      const response = await request(app).get(`${PUBLIC}/hotel`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        name: 'Hôtel de test',
        address: '1 quai de test, 13002 Marseille',
        phone: { display: '04 65 71 00 00', international: '+33465710000' },
        email: 'contact@test.example',
        checkInFrom: '15:00',
        checkOutBefore: '12:00',
        timeZone: 'Europe/Paris',
        bookingRules: {
          maxStayNights: 30,
          bookingHorizonDays: 30,
          sameDayCutoffMinutes: 1380,
          nonRefundableDiscountPercent: 10,
          freeCancellationHours: 48,
        },
      });
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      // No session on the public part of the API.
      expect(response.headers['set-cookie']).toBe(undefined);
    });

    it('GET /room-categories lists the bookable categories, in display order', async () => {
      const response = await request(app).get(`${PUBLIC}/room-categories`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      const items = response.body.items as CategoryBody[];
      // Inactive category and category without an active room are not shown.
      expect(items.map((item) => item.code)).toEqual(['test-vue-port', 'test-patio']);
      expect(items[0]).toEqual({
        code: 'test-vue-port',
        name: { fr: 'Nom test-vue-port', en: 'Name test-vue-port' },
        description: { fr: 'Description FR', en: 'Description EN' },
        beds: { fr: '1 lit double', en: '1 double bed' },
        maxOccupancy: 3,
        baseOccupancy: 2,
        areaSqm: 20,
        // The inactive room is not counted.
        roomCount: 2,
        amenities: ['wifi', 'shower'],
        basePriceCents: 10_000,
        extraAdultCents: 2500,
        extraChildCents: 1500,
        // Cheapest night: the event at -50 % (5 000), then -10 % non-refundable.
        fromPriceCents: 4500,
      });
      // Only the season applies: 8 000 + 20 % = 9 600, then -10 %.
      expect(items[1]?.fromPriceCents).toBe(8640);
      expect(items[1]?.roomCount).toBe(1);
      // No internal identifier leaves the API.
      expect(items.some((item) => 'id' in item)).toBe(false);
    });

    it('GET /services lists only the active options that can be booked online', async () => {
      const response = await request(app).get(`${PUBLIC}/services`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.body).toEqual({
        items: [
          {
            code: 'test-petit-dejeuner',
            name: { fr: 'Petit-déjeuner', en: 'Breakfast' },
            unitPriceCents: 1400,
            pricingUnit: 'per_person_night',
          },
        ],
      });
    });

    it('refuses any other method on these addresses', async () => {
      const response = await request(app).post(`${PUBLIC}/room-categories`).send({});
      expect(response.status).toBe(404);
    });
  });
});
