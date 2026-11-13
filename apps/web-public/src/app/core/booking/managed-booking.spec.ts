import { describe, expect, it } from 'vitest';
import { managedBookingOf, manageStateOf } from './managed-booking';

const BOOKING = {
  reference: 'K7M2QX9A',
  status: 'confirmed',
  checkIn: '2027-01-12',
  checkOut: '2027-01-15',
  category: 'double-standard',
  roomCount: 1,
  ratePlan: 'flexible',
  paidOnlineCents: 0,
  dueAtHotelCents: 43_500,
  firstName: 'Lina',
  freeCancellationUntil: '2027-01-10T14:00:00.000Z',
  cancellation: 'free',
};

describe('managed booking', () => {
  it('reads the booking of a secret link, and refuses an answer of another shape', () => {
    expect(managedBookingOf(BOOKING)).toEqual(BOOKING);
    expect(managedBookingOf({ ...BOOKING, cancellation: 'maybe' })).toBeNull();
    expect(managedBookingOf({ ...BOOKING, firstName: 3 })).toBeNull();
    expect(managedBookingOf({ ...BOOKING, freeCancellationUntil: 'demain' })).toBeNull();
    expect(managedBookingOf({ ...BOOKING, freeCancellationUntil: null })).not.toBeNull();
  });

  it('shows the form « Lien perdu » for a link not valid, and waits when the API is down', () => {
    expect(manageStateOf({ status: 200, body: BOOKING }).kind).toBe('found');
    expect(manageStateOf({ status: 404, body: { code: 'MANAGE_LINK_INVALID' } })).toEqual({
      kind: 'invalid',
    });
    expect(manageStateOf({ status: 400, body: {} })).toEqual({ kind: 'invalid' });
    expect(manageStateOf({ status: 429, body: {} })).toEqual({ kind: 'busy' });
    expect(manageStateOf({ status: 502, body: {} })).toEqual({ kind: 'unavailable' });
    expect(manageStateOf({ status: 200, body: { reference: 'X' } })).toEqual({
      kind: 'unavailable',
    });
  });
});
