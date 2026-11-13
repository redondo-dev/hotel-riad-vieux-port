import { type BookingSummary, bookingSummaryOf } from './online-booking';

/**
 * « Gérer ma réservation » (step M): the booking read with its secret link, as the API gives
 * it (no card data), and what the page then shows. Pure: the page makes the calls, through the
 * relay of the site.
 */

/** What the customer may do himself; decided by the API. */
export type OnlineCancellation = 'free' | 'with_fee' | 'not_refundable' | 'closed';

export interface ManagedBooking extends BookingSummary {
  firstName: string;
  /** ISO instant, flexible rate only. */
  freeCancellationUntil: string | null;
  cancellation: OnlineCancellation;
}

const CANCELLATIONS = ['free', 'with_fee', 'not_refundable', 'closed'] as const;

function isInstantOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

/** null for an answer of an unexpected shape. */
export function managedBookingOf(body: unknown): ManagedBooking | null {
  const summary = bookingSummaryOf(body);
  if (summary === null || typeof body !== 'object' || body === null) {
    return null;
  }
  const { firstName, freeCancellationUntil, cancellation } = body as Record<string, unknown>;
  const found = CANCELLATIONS.find((item) => item === cancellation);
  const deadline = freeCancellationUntil;
  if (typeof firstName !== 'string' || found === undefined || !isInstantOrNull(deadline)) {
    return null;
  }
  return { ...summary, firstName, freeCancellationUntil: deadline, cancellation: found };
}

/** What the page shows after a reading or a cancellation. */
export type ManageState =
  | { kind: 'found'; booking: ManagedBooking }
  /** No link, a link not valid any more, or expired: the form « Lien perdu ». */
  | { kind: 'invalid' }
  /** Too many attempts from this address. */
  | { kind: 'busy' }
  /** The API did not answer: try again later. */
  | { kind: 'unavailable' };

export function manageStateOf(answer: { status: number; body: unknown }): ManageState {
  if (answer.status === 200) {
    const booking = managedBookingOf(answer.body);
    return booking === null ? { kind: 'unavailable' } : { kind: 'found', booking };
  }
  if (answer.status === 400 || answer.status === 404) {
    return { kind: 'invalid' };
  }
  return answer.status === 429 ? { kind: 'busy' } : { kind: 'unavailable' };
}
