import { describe, expect, it } from 'vitest';
import { availabilityResultOf } from './availability-result';

const OFFER = {
  code: 'double-standard',
  roomsLeft: null,
  flexibleCents: 37_800,
  nonRefundableCents: 34_020,
  touristTaxCents: 0,
};

function body(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    checkIn: '2027-05-12',
    checkOut: '2027-05-15',
    nights: 3,
    rooms: [{ adults: 2, childrenAges: [] }],
    freeCancellationUntil: '2027-05-10T13:00:00.000Z',
    offers: [OFFER],
    ...changes,
  };
}

describe('availabilityResultOf', () => {
  it('keeps the offers of a valid answer', () => {
    expect(availabilityResultOf({ status: 200, body: body() })).toEqual({
      kind: 'found',
      availability: {
        nights: 3,
        freeCancellationUntil: '2027-05-10T13:00:00.000Z',
        offers: [OFFER],
      },
    });
  });

  it('treats an answer of an unexpected shape as an outage', () => {
    for (const changes of [
      { offers: 'none' },
      { nights: 0 },
      { offers: [{ ...OFFER, flexibleCents: '378' }] },
      { offers: [{ ...OFFER, roomsLeft: -1 }] },
    ]) {
      expect(availabilityResultOf({ status: 200, body: body(changes) })).toEqual({
        kind: 'unavailable',
      });
    }
  });

  it('tells a refused search, too many searches and an outage apart', () => {
    expect(availabilityResultOf({ status: 400, body: {} }).kind).toBe('refused');
    expect(availabilityResultOf({ status: 429, body: {} }).kind).toBe('busy');
    expect(availabilityResultOf({ status: 502, body: {} }).kind).toBe('unavailable');
    expect(availabilityResultOf({ status: 503, body: {} }).kind).toBe('unavailable');
  });
});
