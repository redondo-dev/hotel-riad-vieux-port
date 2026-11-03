import type { Role } from '../../identity/domain/identity-rules.ts';
import type { RatePlan, ReservationStatus } from './reservation-rules.ts';

/**
 * Pure rules of the front desk (UI/UX specification, section 5.H): when an arrival, a departure
 * or a no-show may be recorded, and the fee of a no-show. Dates are « YYYY-MM-DD » at the hotel.
 */

/** The reception and the management record arrivals and departures. */
export const FRONT_DESK_ROLES: readonly Role[] = ['direction', 'reception'];

interface StayState {
  status: ReservationStatus;
  checkIn: string;
  checkOut: string;
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

function dayText(date: string): string {
  return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

/**
 * Why the arrival cannot be recorded `today`, or null when it can: a confirmed stay, from the
 * arrival day until the day before the departure (a guest arriving after midnight).
 */
export function checkInProblem(stay: StayState, today: string): string | null {
  if (stay.status !== 'confirmed') {
    return 'Seule une réservation confirmée peut être enregistrée à l’arrivée.';
  }
  if (today < stay.checkIn) {
    return `L’arrivée est prévue le ${dayText(stay.checkIn)} : trop tôt pour l’enregistrer.`;
  }
  if (today >= stay.checkOut) {
    return 'Le séjour est passé : déclarez plutôt une non-présentation.';
  }
  return null;
}

/** Why the departure cannot be recorded `today`: on the departure day, or later if forgotten. */
export function checkOutProblem(stay: StayState, today: string): string | null {
  if (stay.status !== 'checked_in') {
    return 'Seul un client arrivé peut être enregistré au départ.';
  }
  if (today < stay.checkOut) {
    return (
      `Le départ est prévu le ${dayText(stay.checkOut)} : un départ anticipé n’est pas ` +
      'encore possible.'
    );
  }
  return null;
}

/** Why a no-show cannot be declared `today`: a confirmed stay, from the day after the arrival. */
export function noShowProblem(stay: StayState, today: string): string | null {
  if (stay.status !== 'confirmed') {
    return 'Seule une réservation confirmée, sans arrivée enregistrée, peut être non présentée.';
  }
  if (today <= stay.checkIn) {
    return `Possible à partir du lendemain de l’arrivée prévue (${dayText(stay.checkIn)}).`;
  }
  return null;
}

/**
 * Fee of a no-show (RM-17), in cents: the first night of each room at the flexible rate, every
 * night at the non-refundable rate. Services and tourist tax are never due: the guest never came.
 */
export function noShowFeeCents(
  ratePlan: RatePlan,
  nights: { firstNightsCents: number; nightsCents: number },
): number {
  return ratePlan === 'non_refundable' ? nights.nightsCents : nights.firstNightsCents;
}
