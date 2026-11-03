import { describe, expect, it } from 'vitest';
import {
  type AvailabilityAnswer,
  type CategoryAvailability,
  roomsTotal,
  serializeGuests,
  serviceQuantity,
  unavailableReason,
} from './booking-model';

function category(changes: Partial<CategoryAvailability>): CategoryAvailability {
  return {
    id: 'double',
    code: 'double',
    name: 'Double',
    maxOccupancy: 2,
    baseOccupancy: 2,
    freeRooms: 3,
    closed: false,
    offers: [
      { fits: true, flexibleCents: 20_000, nonRefundableCents: 18_000, touristTaxCents: 500 },
    ],
    ...changes,
  };
}

describe('serializeGuests', () => {
  it('writes the guests as the API reads them', () => {
    const rooms = [{ adults: 2, childrenAges: [6, 3] }, { adults: 2, childrenAges: [] }];
    expect(serializeGuests(rooms)).toBe('2-6-3_2');
  });
});

describe('unavailableReason', () => {
  it('says why a category cannot be chosen', () => {
    expect(unavailableReason(category({}), 0)).toBeNull();
    expect(unavailableReason(category({ closed: true }), 0)).toBe('Fermée à la vente');
    expect(unavailableReason(category({ offers: [{ fits: false }] }), 0)).toBe('Capacité dépassée');
    expect(unavailableReason(category({ freeRooms: 0 }), 0)).toBe('Complet');
  });
});

describe('roomsTotal', () => {
  const answer: AvailabilityAnswer = {
    checkIn: '2034-05-10',
    checkOut: '2034-05-12',
    nights: 2,
    rooms: [{ adults: 2, childrenAges: [] }],
    categories: [category({})],
  };

  it('adds the rooms at the chosen rate and their tourist tax', () => {
    expect(roomsTotal(answer, ['double'], 'flexible')).toEqual({
      roomsCents: 20_000,
      touristTaxCents: 500,
    });
    expect(roomsTotal(answer, ['double'], 'non_refundable')?.roomsCents).toBe(18_000);
  });

  it('waits until every room has a category', () => {
    expect(roomsTotal(answer, [null], 'flexible')).toBeNull();
  });
});

describe('serviceQuantity', () => {
  it('counts breakfast per guest and per night, babies excepted (RM-12)', () => {
    const rooms = [{ adults: 2, childrenAges: [6, 1] }, { adults: 1, childrenAges: [] }];
    expect(serviceQuantity('per_person_night', rooms, 2, 1)).toBe(8);
    expect(serviceQuantity('per_unit', rooms, 2, 3)).toBe(3);
  });
});
