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
    photos: [],
  };
}

const PHOTO_ID = '0b9f6a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b';

/** A photo as the API gives it: three versions served under /api/v1/public/media. */
function photoBody(): Record<string, unknown> {
  return {
    alt: { fr: 'Lit double face au port', en: 'Double bed facing the harbour' },
    width: 1600,
    height: 1067,
    sources: [400, 800, 1600].map((width) => ({
      width,
      url: `/api/v1/public/media/${PHOTO_ID}-${width}.webp`,
    })),
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

  it('keeps only the file names of the photos', () => {
    const category = { ...categoryBody(), photos: [photoBody()] };
    const snapshot = parseCatalogSnapshot(hotelBody(), { items: [category] }, { items: [] }, AT);

    expect(snapshot.categories[0]?.photos).toEqual([
      {
        alt: { fr: 'Lit double face au port', en: 'Double bed facing the harbour' },
        width: 1600,
        height: 1067,
        files: [
          { width: 400, file: `${PHOTO_ID}-400.webp` },
          { width: 800, file: `${PHOTO_ID}-800.webp` },
          { width: 1600, file: `${PHOTO_ID}-1600.webp` },
        ],
      },
    ]);
  });

  it('refuses a photo address that is not an expected file of the API', () => {
    const path = 'categories[0].photos[0].sources[0].url';
    for (const url of [
      'https://example.com/photo.webp',
      `/api/v1/public/media/../${PHOTO_ID}-400.webp`,
      `/api/v1/public/media/${PHOTO_ID}-400.png`,
      `/api/v1/public/media/${PHOTO_ID}-500.webp`,
    ]) {
      const photo = { ...photoBody(), sources: [{ width: 400, url }] };
      const category = { ...categoryBody(), photos: [photo] };
      expect(parseWith([category], [])).toThrow(new CatalogFormatError(path));
    }
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
