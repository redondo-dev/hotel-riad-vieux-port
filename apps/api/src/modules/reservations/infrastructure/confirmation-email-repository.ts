import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { CancellationEmailData } from '../domain/cancellation-email.ts';
import type { ConfirmationEmailData } from '../domain/confirmation-email.ts';
import type { RatePlan } from '../domain/reservation-rules.ts';

/** Failed attempts after which an e-mail is given up (written to the server log). */
export const MAX_EMAIL_ATTEMPTS = 10;

/** What the e-mail needs, with the address it goes to. */
export interface ConfirmationToSend {
  id: string;
  to: string;
  data: ConfirmationEmailData;
}

interface BookingRow {
  id: string;
  reference: string;
  email: string;
  firstName: string;
  language: 'fr' | 'en';
  checkIn: string;
  checkOut: string;
  ratePlan: RatePlan;
  totalCents: number;
  freeCancellationUntil: Date | null;
  cardGuarantee: boolean;
  paidOnlineCents: number;
  touristTaxCents: number;
}

/**
 * The e-mails of confirmation of the bookings of the website (step R-6), in plain SQL with
 * bound parameters: the confirmed bookings not sent yet, what their e-mail says, and the
 * instant it was sent.
 */
export class ConfirmationEmailRepository {
  readonly #sequelize: Sequelize;

  constructor(sequelize: Sequelize) {
    this.#sequelize = sequelize;
  }

  /**
   * Confirmed bookings of the website whose e-mail is not sent yet, the oldest first; not the
   * stays already over (on the day of the hotel at `now`), nor the e-mails given up.
   */
  async unsent(now: Date, limit: number): Promise<string[]> {
    const rows = await this.#sequelize.query<{ id: string }>(
      `SELECT id
         FROM reservations
        WHERE source = 'website' AND status = 'confirmed' AND confirmation_email_sent_at IS NULL
          AND confirmation_email_attempts < $3
          AND check_out > ($1::timestamptz AT TIME ZONE 'Europe/Paris')::date
        ORDER BY created_at
        LIMIT $2`,
      { bind: [now, limit, MAX_EMAIL_ATTEMPTS], type: QueryTypes.SELECT },
    );
    return rows.map((row) => row.id);
  }

  /**
   * Locks one booking still to be sent and reads its e-mail; undefined when it was sent
   * meanwhile, or is being sent by another copy of the API (SKIP LOCKED: never waited for).
   */
  async lockUnsent(id: string, transaction: Transaction): Promise<ConfirmationToSend | undefined> {
    const bookings = await this.#sequelize.query<BookingRow>(
      `SELECT r.id, r.reference, c.email::text AS email, c.first_name AS "firstName",
              c.preferred_language AS language, r.check_in::text AS "checkIn",
              r.check_out::text AS "checkOut", r.rate_plan AS "ratePlan",
              r.total_amount_cents AS "totalCents",
              r.free_cancellation_until AS "freeCancellationUntil",
              r.stripe_payment_method_id IS NOT NULL AS "cardGuarantee",
              (SELECT COALESCE(sum(p.amount_cents), 0)::int
                 FROM payments p
                WHERE p.reservation_id = r.id AND p.kind = 'payment'
                  AND p.method = 'card_online' AND p.status = 'succeeded') AS "paidOnlineCents",
              (SELECT COALESCE(sum(ch.total_cents), 0)::int
                 FROM reservation_charges ch
                WHERE ch.reservation_id = r.id AND ch.kind = 'tourist_tax') AS "touristTaxCents"
         FROM reservations r
         JOIN customers c ON c.id = r.customer_id
        WHERE r.id = $1 AND r.status = 'confirmed' AND r.confirmation_email_sent_at IS NULL
          FOR UPDATE OF r SKIP LOCKED`,
      { bind: [id], type: QueryTypes.SELECT, transaction },
    );
    const booking = bookings[0];
    if (booking === undefined) {
      return undefined;
    }
    const rooms = await this.#sequelize.query<{ nameFr: string; nameEn: string; count: number }>(
      `SELECT c.name_fr AS "nameFr", c.name_en AS "nameEn", count(*)::int AS count
         FROM reservation_rooms l
         JOIN room_categories c ON c.id = l.category_id
        WHERE l.reservation_id = $1
        GROUP BY c.id, c.name_fr, c.name_en, c.sort_order
        ORDER BY c.sort_order`,
      { bind: [id], type: QueryTypes.SELECT, transaction },
    );
    const hotels = await this.#sequelize.query<ConfirmationEmailData['hotel']>(
      `SELECT name, address, phone, email::text AS email, check_in_time::text AS "checkInTime",
              check_out_time::text AS "checkOutTime"
         FROM hotel_settings
        WHERE id = 1`,
      { type: QueryTypes.SELECT, transaction },
    );
    const hotel = hotels[0];
    if (hotel === undefined) {
      throw new Error('Réglages de l’hôtel absents : e-mail de confirmation impossible');
    }
    const { email, ...fields } = booking;
    return {
      id: booking.id,
      to: email,
      data: {
        language: fields.language,
        firstName: fields.firstName,
        reference: fields.reference,
        checkIn: fields.checkIn,
        checkOut: fields.checkOut,
        rooms,
        ratePlan: fields.ratePlan,
        totalCents: fields.totalCents,
        paidOnlineCents: fields.paidOnlineCents,
        touristTaxCents: fields.touristTaxCents,
        freeCancellationUntil: fields.freeCancellationUntil,
        cardGuarantee: fields.cardGuarantee,
        // Made when the e-mail is sent (ConfirmationEmails): never stored but as its hash.
        manageUrl: null,
        hotel,
      },
    };
  }

  /** One more failed attempt; returns how many there are now. */
  async countFailure(id: string): Promise<number> {
    const rows = await this.#sequelize.query<{ attempts: number }>(
      `UPDATE reservations SET confirmation_email_attempts = confirmation_email_attempts + 1
        WHERE id = $1
        RETURNING confirmation_email_attempts AS attempts`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    return rows[0]?.attempts ?? 0;
  }

  async markSent(id: string, at: Date, transaction: Transaction): Promise<void> {
    await this.#sequelize.query(
      `UPDATE reservations SET confirmation_email_sent_at = $2
        WHERE id = $1 AND confirmation_email_sent_at IS NULL`,
      { bind: [id, at], transaction },
    );
  }

  // --- E-mail of cancellation (step M) ---

  /**
   * Bookings of the website cancelled after their confirmation was e-mailed (the ones that
   * expired unpaid were never confirmed: nothing to tell), whose e-mail of cancellation is not
   * sent yet, the stay not over; the oldest first.
   */
  async unsentCancellations(now: Date, limit: number): Promise<string[]> {
    const rows = await this.#sequelize.query<{ id: string }>(
      `SELECT id
         FROM reservations
        WHERE source = 'website' AND status = 'cancelled'
          AND confirmation_email_sent_at IS NOT NULL AND cancellation_email_sent_at IS NULL
          AND cancellation_email_attempts < $3
          AND check_out > ($1::timestamptz AT TIME ZONE 'Europe/Paris')::date
        ORDER BY cancelled_at
        LIMIT $2`,
      { bind: [now, limit, MAX_EMAIL_ATTEMPTS], type: QueryTypes.SELECT },
    );
    return rows.map((row) => row.id);
  }

  /** Locks one cancellation still to be told and reads its e-mail (SKIP LOCKED). */
  async lockUnsentCancellation(
    id: string,
    transaction: Transaction,
  ): Promise<{ id: string; to: string; data: CancellationEmailData } | undefined> {
    const bookings = await this.#sequelize.query<{
      email: string;
      firstName: string;
      language: 'fr' | 'en';
      reference: string;
      checkIn: string;
      checkOut: string;
      ratePlan: RatePlan;
      feeCents: number;
    }>(
      `SELECT c.email::text AS email, c.first_name AS "firstName",
              c.preferred_language AS language, r.reference, r.check_in::text AS "checkIn",
              r.check_out::text AS "checkOut", r.rate_plan AS "ratePlan",
              r.cancellation_fee_cents AS "feeCents"
         FROM reservations r
         JOIN customers c ON c.id = r.customer_id
        WHERE r.id = $1 AND r.status = 'cancelled' AND r.cancellation_email_sent_at IS NULL
          FOR UPDATE OF r SKIP LOCKED`,
      { bind: [id], type: QueryTypes.SELECT, transaction },
    );
    const booking = bookings[0];
    if (booking === undefined) {
      return undefined;
    }
    const rooms = await this.#sequelize.query<{ nameFr: string; nameEn: string; count: number }>(
      `SELECT c.name_fr AS "nameFr", c.name_en AS "nameEn", count(*)::int AS count
         FROM reservation_rooms l
         JOIN room_categories c ON c.id = l.category_id
        WHERE l.reservation_id = $1
        GROUP BY c.id, c.name_fr, c.name_en, c.sort_order
        ORDER BY c.sort_order`,
      { bind: [id], type: QueryTypes.SELECT, transaction },
    );
    const hotels = await this.#sequelize.query<CancellationEmailData['hotel']>(
      `SELECT name, address, phone, email::text AS email FROM hotel_settings WHERE id = 1`,
      { type: QueryTypes.SELECT, transaction },
    );
    const hotel = hotels[0];
    if (hotel === undefined) {
      throw new Error('Réglages de l’hôtel absents : e-mail d’annulation impossible');
    }
    const { email, ...fields } = booking;
    return { id, to: email, data: { ...fields, rooms, hotel } };
  }

  async markCancellationSent(id: string, at: Date, transaction: Transaction): Promise<void> {
    await this.#sequelize.query(
      `UPDATE reservations SET cancellation_email_sent_at = $2
        WHERE id = $1 AND cancellation_email_sent_at IS NULL`,
      { bind: [id, at], transaction },
    );
  }

  /** One more refusal of the e-mail of cancellation itself; returns how many there are now. */
  async countCancellationFailure(id: string): Promise<number> {
    const rows = await this.#sequelize.query<{ attempts: number }>(
      `UPDATE reservations SET cancellation_email_attempts = cancellation_email_attempts + 1
        WHERE id = $1
        RETURNING cancellation_email_attempts AS attempts`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    return rows[0]?.attempts ?? 0;
  }
}
