import type {
  BookingRules,
  CatalogSnapshot,
  HotelInfo,
  HotelOption,
  LocalizedText,
  PricingUnit,
  RoomCategory,
} from './catalog.js';

/**
 * Reads the three answers of the public API (GET /public/hotel, /public/room-categories,
 * /public/services) into one CatalogSnapshot, checking each field on the way: an answer of an
 * unexpected shape is refused as a whole rather than half displayed.
 */

export class CatalogFormatError extends Error {
  constructor(path: string) {
    super(`réponse inattendue de l’API du catalogue : ${path}`);
    this.name = 'CatalogFormatError';
  }
}

type Fields = Record<string, unknown>;

function fields(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogFormatError(path);
  }
  return value as Fields;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new CatalogFormatError(path);
  }
  return value;
}

function amount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CatalogFormatError(path);
  }
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CatalogFormatError(path);
  }
  return value;
}

function localized(value: unknown, path: string): LocalizedText {
  const item = fields(value, path);
  return { fr: text(item['fr'], `${path}.fr`), en: text(item['en'], `${path}.en`) };
}

const PRICING_UNITS: readonly PricingUnit[] = [
  'per_person_night',
  'per_night',
  'per_stay',
  'per_unit',
];

function pricingUnit(value: unknown, path: string): PricingUnit {
  const unit = PRICING_UNITS.find((candidate) => candidate === value);
  if (unit === undefined) {
    throw new CatalogFormatError(path);
  }
  return unit;
}

function hotelOf(body: Fields): HotelInfo {
  const phone = fields(body['phone'], 'hotel.phone');
  return {
    name: text(body['name'], 'hotel.name'),
    address: text(body['address'], 'hotel.address'),
    phone: {
      display: text(phone['display'], 'hotel.phone.display'),
      international: text(phone['international'], 'hotel.phone.international'),
    },
    email: text(body['email'], 'hotel.email'),
    checkInFrom: text(body['checkInFrom'], 'hotel.checkInFrom'),
    checkOutBefore: text(body['checkOutBefore'], 'hotel.checkOutBefore'),
    timeZone: text(body['timeZone'], 'hotel.timeZone'),
  };
}

function bookingRulesOf(body: Fields): BookingRules {
  const rules = fields(body['bookingRules'], 'hotel.bookingRules');
  const path = 'hotel.bookingRules';
  return {
    maxStayNights: amount(rules['maxStayNights'], `${path}.maxStayNights`),
    bookingHorizonDays: amount(rules['bookingHorizonDays'], `${path}.bookingHorizonDays`),
    sameDayCutoffMinutes: amount(rules['sameDayCutoffMinutes'], `${path}.sameDayCutoffMinutes`),
    nonRefundableDiscountPercent: amount(
      rules['nonRefundableDiscountPercent'],
      `${path}.nonRefundableDiscountPercent`,
    ),
    freeCancellationHours: amount(rules['freeCancellationHours'], `${path}.freeCancellationHours`),
  };
}

function categoryOf(value: unknown, index: number): RoomCategory {
  const path = `categories[${index}]`;
  const item = fields(value, path);
  return {
    code: text(item['code'], `${path}.code`),
    name: localized(item['name'], `${path}.name`),
    description: localized(item['description'], `${path}.description`),
    beds: localized(item['beds'], `${path}.beds`),
    maxOccupancy: amount(item['maxOccupancy'], `${path}.maxOccupancy`),
    baseOccupancy: amount(item['baseOccupancy'], `${path}.baseOccupancy`),
    areaSqm: amount(item['areaSqm'], `${path}.areaSqm`),
    roomCount: amount(item['roomCount'], `${path}.roomCount`),
    basePriceCents: amount(item['basePriceCents'], `${path}.basePriceCents`),
    extraAdultCents: amount(item['extraAdultCents'], `${path}.extraAdultCents`),
    extraChildCents: amount(item['extraChildCents'], `${path}.extraChildCents`),
    fromPriceCents: amount(item['fromPriceCents'], `${path}.fromPriceCents`),
    amenities: list(item['amenities'], `${path}.amenities`).map((code, position) => {
      return text(code, `${path}.amenities[${position}]`);
    }),
  };
}

function optionOf(value: unknown, index: number): HotelOption {
  const path = `options[${index}]`;
  const item = fields(value, path);
  return {
    code: text(item['code'], `${path}.code`),
    name: localized(item['name'], `${path}.name`),
    unitPriceCents: amount(item['unitPriceCents'], `${path}.unitPriceCents`),
    pricingUnit: pricingUnit(item['pricingUnit'], `${path}.pricingUnit`),
  };
}

export function parseCatalogSnapshot(
  hotelBody: unknown,
  categoriesBody: unknown,
  servicesBody: unknown,
  fetchedAt: Date,
): CatalogSnapshot {
  const hotel = fields(hotelBody, 'hotel');
  const categories = list(fields(categoriesBody, 'categories')['items'], 'categories.items');
  const options = list(fields(servicesBody, 'options')['items'], 'options.items');
  return {
    hotel: hotelOf(hotel),
    bookingRules: bookingRulesOf(hotel),
    categories: categories.map(categoryOf),
    options: options.map(optionOf),
    fetchedAt: fetchedAt.toISOString(),
  };
}
