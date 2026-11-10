import { describe, expect, it } from 'vitest';
import {
  isSlow,
  MAX_REFRESHES,
  REFRESH_EVERY_MS,
  refreshedSummary,
  shouldRefresh,
} from './confirmation-refresh';
import type { BookingSummary } from './online-booking';

const PENDING: BookingSummary = {
  reference: 'K7M2QX9A',
  status: 'pending',
  checkIn: '2027-01-12',
  checkOut: '2027-01-15',
  category: 'double-standard',
  roomCount: 1,
  ratePlan: 'non_refundable',
  paidOnlineCents: 28_350,
  dueAtHotelCents: 1500,
};
const CONFIRMED: BookingSummary = { ...PENDING, status: 'confirmed' };

describe('confirmation refresh', () => {
  it('reads again every 3 seconds for 30 seconds, while the payment is being checked', () => {
    expect(REFRESH_EVERY_MS * MAX_REFRESHES).toBe(30_000);
    expect(shouldRefresh(PENDING, 0)).toBe(true);
    expect(shouldRefresh(PENDING, MAX_REFRESHES - 1)).toBe(true);
    expect(shouldRefresh(PENDING, MAX_REFRESHES)).toBe(false);
    expect(shouldRefresh(CONFIRMED, 0)).toBe(false);
    expect(shouldRefresh({ ...PENDING, status: 'cancelled' }, 0)).toBe(false);
  });

  it('tells the visitor to come back later only once the reads are over', () => {
    expect(isSlow(PENDING, MAX_REFRESHES - 1)).toBe(false);
    expect(isSlow(PENDING, MAX_REFRESHES)).toBe(true);
    expect(isSlow(CONFIRMED, MAX_REFRESHES)).toBe(false);
  });

  it('shows the new state of the same booking, and keeps what is shown otherwise', () => {
    expect(refreshedSummary(PENDING, { status: 200, body: CONFIRMED })).toEqual(CONFIRMED);
    expect(refreshedSummary(PENDING, { status: 502, body: null })).toBe(PENDING);
    expect(refreshedSummary(PENDING, { status: 200, body: { status: 'confirmed' } })).toBe(PENDING);
    const other = { ...CONFIRMED, reference: 'ZZZZ2222' };
    expect(refreshedSummary(PENDING, { status: 200, body: other })).toBe(PENDING);
  });
});
