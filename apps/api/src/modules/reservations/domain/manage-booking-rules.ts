import { createHash, randomBytes } from 'node:crypto';
import type { RatePlan, ReservationStatus } from './reservation-rules.ts';

/**
 * « Gérer ma réservation » (step M): the customer opens his booking of the website with a
 * secret link « …/reservation/gerer#REFERENCE.token » (decision « 1a »: the token stays in the
 * part of the address after #, never sent to any server but by the page itself).
 */

/** 256 random bits: impossible to guess. */
const TOKEN_BYTES = 32;

/** 32 bytes in base64url: 43 letters, digits, « - » and « _ ». */
export const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Only this fingerprint is stored: reading the database does not give the links. */
export function manageTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: manageTokenHash(token) };
}

/**
 * What the customer may do himself (decision « 2a »):
 *  - free: flexible rate, before the free cancellation deadline: cancelled online, at no cost;
 *  - with_fee: flexible rate after the deadline: one night is due, the reception is called;
 *  - not_refundable: never cancelled online;
 *  - closed: the booking is no longer active, or the stay has begun.
 */
export type OnlineCancellation = 'free' | 'with_fee' | 'not_refundable' | 'closed';

export function onlineCancellation(booking: {
  status: ReservationStatus;
  ratePlan: RatePlan;
  freeCancellationUntil: Date | null;
  now: Date;
}): OnlineCancellation {
  if (booking.status !== 'confirmed') {
    return 'closed';
  }
  if (booking.ratePlan === 'non_refundable') {
    return 'not_refundable';
  }
  const deadline = booking.freeCancellationUntil;
  return deadline !== null && booking.now <= deadline ? 'free' : 'with_fee';
}

/** Reason written on the booking and shown to the staff. */
export const CUSTOMER_CANCELLATION_REASON = 'Annulée par le client depuis le site';
