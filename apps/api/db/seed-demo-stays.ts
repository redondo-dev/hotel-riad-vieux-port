import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize } from 'sequelize';
import { AppError } from '../src/shared/domain/errors.ts';
import { hotelToday } from '../src/modules/catalog/domain/pricing.ts';
import type { StaffUser } from '../src/modules/identity/domain/identity-rules.ts';
import { ReservationChanges } from '../src/modules/reservations/application/reservation-changes.ts';
import {
  type NewBooking,
  ReservationService,
} from '../src/modules/reservations/application/reservation-service.ts';
import {
  type DemoStay,
  demoEmails,
  demoStayPlan,
} from '../src/modules/reservations/domain/demo-stays.ts';

/**
 * Loads the demo stays (decision of module 8): about forty reservations around today, through
 * the same services as the staff screens, so that every price, night, charge and audit line is
 * the real one. A stay already begun is booked « as of » its arrival day, then marked arrived or
 * departed.
 *
 * Safety: called by seed-demo.ts only (DEMO_MODE=true); loaded once — if one demo customer
 * exists already, nothing is added; never deletes nor changes a reservation it did not create.
 */

const ORIGIN = { ip: undefined };

async function staffAccount(sequelize: Sequelize, email: string): Promise<StaffUser> {
  const rows = await sequelize.query<StaffUser>(
    `SELECT id, email, first_name AS "firstName", last_name AS "lastName", role
       FROM users WHERE email = $1`,
    { bind: [email], type: QueryTypes.SELECT },
  );
  const user = rows[0];
  if (user === undefined) {
    throw new Error(`Compte de démonstration introuvable : ${email}`);
  }
  return user;
}

async function idsByCode(
  sequelize: Sequelize,
  table: 'room_categories' | 'services',
): Promise<Map<string, string>> {
  const rows = await sequelize.query<{ id: string; code: string }>(
    `SELECT id, code FROM ${table} WHERE is_active`,
    { type: QueryTypes.SELECT },
  );
  return new Map(rows.map((row) => [row.code, row.id]));
}

function bookingOf(stay: DemoStay, categoryId: string, breakfastId?: string): NewBooking {
  const room = { categoryId, adults: stay.adults, childrenAges: stay.childrenAges, babyCot: false };
  const breakfast = stay.breakfast && breakfastId !== undefined;
  return {
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    ratePlan: stay.ratePlan,
    source: stay.source,
    rooms: [room],
    services: breakfast ? [{ serviceId: breakfastId, quantity: 1 }] : [],
    customer: { ...stay.customer, phone: null },
    customerMessage: null,
    internalNotes: 'Séjour de démonstration.',
  };
}

/** Returns the number of stays loaded (0 when the demo stays exist already). */
export async function seedDemoStays(
  sequelize: Sequelize,
  accounts: { direction: string; reception: string },
): Promise<number> {
  const existing = await sequelize.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM customers WHERE email = ANY($1::text[])',
    { bind: [demoEmails()], type: QueryTypes.SELECT },
  );
  if ((existing[0]?.count ?? 0) > 0) {
    return 0;
  }

  const direction = await staffAccount(sequelize, accounts.direction);
  const reception = await staffAccount(sequelize, accounts.reception);
  const categories = await idsByCode(sequelize, 'room_categories');
  const breakfastId = (await idsByCode(sequelize, 'services')).get('breakfast');
  const today = hotelToday();
  let loaded = 0;

  for (const stay of demoStayPlan(today)) {
    const categoryId = categories.get(stay.categoryCode);
    if (categoryId === undefined) {
      console.log(`  séjour ignoré (catégorie ${stay.categoryCode} absente)`);
      continue;
    }
    // A stay already begun is booked as on its arrival day: the rules refuse a past arrival.
    const asOf = stay.checkIn < today ? stay.checkIn : today;
    const service = new ReservationService(sequelize, () => asOf);
    const changes = new ReservationChanges(sequelize, () => asOf, () => new Date());
    try {
      const booking = bookingOf(stay, categoryId, breakfastId);
      const { reservation } = await service.create(reception, booking, randomUUID(), ORIGIN);
      const line = reservation.rooms[0];
      if (stay.assigned && line !== undefined) {
        const free = await changes.freeRoomsFor(reservation.id, line.id);
        const room = free[0];
        if (room !== undefined) {
          await changes.assignRoom(reception, reservation.id, line.id, room.id, ORIGIN);
        }
      }
      if (stay.status === 'cancelled') {
        const request = { reason: 'Annulation demandée par le client.', waiveFee: false };
        await changes.cancel(direction, reservation.id, request, ORIGIN);
      } else if (stay.status !== 'confirmed') {
        // Arrivals and departures have no screen yet (module « Aujourd'hui »): set directly.
        await sequelize.query('UPDATE reservations SET status = $2 WHERE id = $1', {
          bind: [reservation.id, stay.status],
        });
      }
      loaded += 1;
    } catch (error) {
      // A full category or a closed one: this stay is left out, the others are loaded.
      const reason = error instanceof AppError ? (error.detail ?? error.title) : String(error);
      console.log(`  séjour ignoré (${stay.customer.email}) : ${reason}`);
    }
  }
  return loaded;
}
