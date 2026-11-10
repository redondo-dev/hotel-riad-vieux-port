import { type BookingSummary, bookingSummaryOf } from './online-booking';

/**
 * The confirmation page reads its booking again while the payment is being checked (step R-5c):
 * Stripe tells the hotel within a few seconds. Pure: the page makes the calls, through the
 * relay of the site (never the API from the browser).
 */

/** Every 3 seconds, for 30 seconds at most: far below the limit of the API (30 per minute). */
export const REFRESH_EVERY_MS = 3_000;
export const MAX_REFRESHES = 10;

/** Whether to read the booking again, `done` reads having been made since the page opened. */
export function shouldRefresh(summary: BookingSummary, done: number): boolean {
  return summary.status === 'pending' && done < MAX_REFRESHES;
}

/** Still being checked after every read: the visitor is told to come back a little later. */
export function isSlow(summary: BookingSummary, done: number): boolean {
  return summary.status === 'pending' && done >= MAX_REFRESHES;
}

/**
 * What to show after a read: the new state of the same booking; anything else (relay down,
 * answer of another shape) keeps what is shown, and the next read tries again.
 */
export function refreshedSummary(
  shown: BookingSummary,
  answer: { status: number; body: unknown },
): BookingSummary {
  if (answer.status !== 200) {
    return shown;
  }
  const read = bookingSummaryOf(answer.body);
  return read !== null && read.reference === shown.reference ? read : shown;
}
