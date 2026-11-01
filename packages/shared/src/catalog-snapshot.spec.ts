import { describe, expect, it } from 'vitest';
import { CatalogFormatError, parseCatalogSnapshot } from './catalog-snapshot.js';

/** Answers as the public API gives them (see apps/api/openapi/openapi.yaml). */
function hotelBody(): Record<string, unknown> {
  return {
    name: 'Hôtel Riad Vieux-Port',
    address: 'Quai du Vieux-Port, 13002 Marseille',
    phone: { display: '04 65 71 00 00', international: '+33465710000' },
    email: 'contact@riad-vieux-port.example',
    checkInFrom: '15:00',
    checkOutBefore: '12:00',
    timeZone: 'Europe/Paris',
    bookingRules: {
      maxStayNights: 30,
      bookingHorizonDays: 365,
      sameDayCutoffMinutes: 1380,
      nonRefundableDiscountPercent: 10,
      freeCancellationHours: 48,
    },
  };
}

function categoryBody(): Record<string, unknown> {
  return {
    code: 'double-standard',
    name: { fr: 'Double standard', en: 'Standard double' },
    description: { fr: 'Lumineuse', en: 'Bright' },
    beds: { fr: '1 lit double', en: '1 double bed' },
    maxOccupancy: 2,
    baseOccupancy: 2,
    areaSqm: 18,
    roomCount: 40,
    amenities: ['wifi', 'shower'],
    basePriceCents: 9500,
    extraAdultCents: 2500,
    extraChildCents: 1500,
    fromPriceCents: 8550,
  };
}

const BREAKFAST = {
  code: 'breakfast',
  name: { fr: 'Petit-déjeuner', en: 'Breakfast' },
  unitPriceCents: 1400,
  pricingUnit: 'per_person_night',
};

const AT = new Date('2026-11-01T18:00:00Z');

/** Parses the given categories and options, with a valid hotel answer. */
function parseWith(categories: unknown[], options: unknown[]): () => unknown {
  return () => {
    return parseCatalogSnapshot(hotelBody(), { items: categories }, { items: options }, AT);
  };
}

describe('parseCatalogSnapshot', () => {
  it('gathers the three answers of the API', () => {
    const snapshot = parseCatalogSnapshot(
      hotelBody(),
      { items: [categoryBody()] },
      { items: [BREAKFAST] },
      AT,
    );

    expect(snapshot.hotel.address).toBe('Quai du Vieux-Port, 13002 Marseille');
    expect(snapshot.hotel.phone.display).toBe('04 65 71 00 00');
    expect(snapshot.bookingRules.nonRefundableDiscountPercent).toBe(10);
    expect(snapshot.categories).toEqual([categoryBody()]);
    expect(snapshot.options).toEqual([BREAKFAST]);
    expect(snapshot.fetchedAt).toBe('2026-11-01T18:00:00.000Z');
    // The booking rules are not repeated inside the hotel information.
    expect('bookingRules' in snapshot.hotel).toBe(false);
  });

  it('refuses an answer of an unexpected shape, naming the field', () => {
    const broken = { ...categoryBody(), fromPriceCents: '85,50' };
    expect(parseWith([broken], [])).toThrow(new CatalogFormatError('categories[0].fromPriceCents'));
  });

  it('refuses an error answer of the API instead of a list', () => {
    const problem = { code: 'HOTEL_NOT_CONFIGURED', title: 'Service indisponible' };
    const parse = (): unknown => parseCatalogSnapshot(problem, problem, problem, AT);
    expect(parse).toThrow(CatalogFormatError);
  });

  it('refuses an unknown pricing unit and a missing English text', () => {
    const unit = { ...BREAKFAST, pricingUnit: 'per_week' };
    expect(parseWith([], [unit])).toThrow(new CatalogFormatError('options[0].pricingUnit'));

    const english = { ...categoryBody(), name: { fr: 'Double' } };
    expect(parseWith([english], [])).toThrow(new CatalogFormatError('categories[0].name.en'));
  });
});
