import type {
  BookingRules,
  CatalogSnapshot,
  CategoryPhoto,
  HotelInfo,
  HotelOption,
  LocalizedText,
  PhotoFile,
  PricingUnit,
  RoomCategory,
} from './catalog.js';
import { MEDIA_FILE_PATTERN } from './media.js';

/**
 * Reads the three answers of the public API (GET /public/hotel, /public/room-categories,
 * /public/services) into one CatalogSnapshot, checking each field on the way: an answer of an
 * unexpected shape is refused as a whole rather than half displayed. Of a photo address, only
 * an expected file name is kept: the site never displays an address chosen by the API.
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

/** A width or a height: a whole number of pixels, or null when unknown. */
function size(value: unknown, path: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new CatalogFormatError(path);
  }
  return value;
}

/** Where the API serves the files; only the file name is kept, and only an expected one. */
const API_MEDIA_PREFIX = '/api/v1/public/media/';

function photoFileOf(value: unknown, path: string): PhotoFile {
  const item = fields(value, path);
  const url = text(item['url'], `${path}.url`);
  const file = url.startsWith(API_MEDIA_PREFIX) ? url.slice(API_MEDIA_PREFIX.length) : '';
  if (!MEDIA_FILE_PATTERN.test(file)) {
    throw new CatalogFormatError(`${path}.url`);
  }
  return { width: amount(item['width'], `${path}.width`), file };
}

function photoOf(value: unknown, path: string): CategoryPhoto {
  const item = fields(value, path);
  return {
    alt: localized(item['alt'], `${path}.alt`),
    width: size(item['width'], `${path}.width`),
    height: size(item['height'], `${path}.height`),
    files: list(item['sources'], `${path}.sources`).map((source, position) => {
      return photoFileOf(source, `${path}.sources[${position}]`);
    }),
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
    photos: list(item['photos'], `${path}.photos`).map((photo, position) => {
      return photoOf(photo, `${path}.photos[${position}]`);
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
