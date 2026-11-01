import type { Role } from '../../core/auth/roles';

/**
 * Catalogue as the API gives it to the staff (GET /admin/catalog/…), and the pure rules of the
 * catalogue screens: rights, labels, formatting and reading of what the staff types. Tested
 * without Angular.
 */

export interface LocalizedText {
  fr: string;
  en: string;
}

export const AMENITY_CODES = [
  'wifi',
  'air-conditioning',
  'tv',
  'safe',
  'hair-dryer',
  'shower',
  'bathtub',
  'sitting-area',
  'port-view',
] as const;
export type AmenityCode = (typeof AMENITY_CODES)[number];

export const AMENITY_LABELS: Record<AmenityCode, string> = {
  wifi: 'Wi-Fi',
  'air-conditioning': 'Climatisation',
  tv: 'Télévision',
  safe: 'Coffre-fort',
  'hair-dryer': 'Sèche-cheveux',
  shower: 'Douche',
  bathtub: 'Baignoire',
  'sitting-area': 'Coin salon',
  'port-view': 'Vue sur le port',
};

export interface Category {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  beds: LocalizedText;
  areaSqm: number;
  maxOccupancy: number;
  baseOccupancy: number;
  basePriceCents: number;
  extraAdultCents: number;
  extraChildCents: number;
  amenities: AmenityCode[];
  sortOrder: number;
  isActive: boolean;
  roomCount: number;
  activeRoomCount: number;
}

export type HousekeepingStatus = 'clean' | 'dirty';

export const HOUSEKEEPING_LABELS: Record<HousekeepingStatus, string> = {
  clean: 'Propre',
  dirty: 'À nettoyer',
};

export interface Room {
  id: string;
  number: string;
  floor: number;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  housekeepingStatus: HousekeepingStatus;
  isActive: boolean;
}

export type RatePeriodKind = 'season' | 'event';

export const RATE_PERIOD_KIND_LABELS: Record<RatePeriodKind, string> = {
  season: 'Saison',
  event: 'Événement',
};

export interface RatePeriod {
  id: string;
  name: string;
  kind: RatePeriodKind;
  firstNight: string;
  lastNight: string;
  adjustmentPct: number;
  /** null: every category. */
  categoryId: string | null;
  categoryCode: string | null;
}

export interface SalesClosure {
  id: string;
  categoryId: string;
  categoryCode: string;
  firstNight: string;
  lastNight: string;
  reason: string | null;
  createdAt: string;
  createdBy: { firstName: string; lastName: string } | null;
}

export const PRICING_UNITS = ['per_person_night', 'per_night', 'per_stay', 'per_unit'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const PRICING_UNIT_LABELS: Record<PricingUnit, string> = {
  per_person_night: 'par personne et par nuit',
  per_night: 'par nuit',
  per_stay: 'par séjour',
  per_unit: 'à l’unité',
};

export interface HotelService {
  id: string;
  code: string;
  name: LocalizedText;
  unitPriceCents: number;
  pricingUnit: PricingUnit;
  vatRate: number;
  bookableOnline: boolean;
  isActive: boolean;
}

// --- Rights (the API checks the same ones: hiding a button is a comfort, not a protection) ---

/** Categories, rooms, rate periods and services: the management only. */
export function canEditCatalog(role: Role | undefined): boolean {
  return role === 'direction';
}

/** Sales closures: the management and the reception (a group at the last minute…). */
export function canManageClosures(role: Role | undefined): boolean {
  return role === 'direction' || role === 'reception';
}

// --- Formatting ---

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 9550 → « 95,50 € ». */
export function formatEuros(cents: number): string {
  return EUROS.format(cents / 100);
}

/** 9550 → « 95,50 », to fill a price field. */
export function eurosInputValue(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

const PERCENT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** 20 → « +20 % »; -15 → « -15 % »; 35.5 → « +35,5 % ». */
export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${PERCENT.format(Math.abs(value))} %`;
}

/** 35.5 → « 35,5 », to fill a percentage field. */
export function percentInputValue(value: number): string {
  return String(value).replace('.', ',');
}

function day(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function dateText(date: string, parts: Intl.DateTimeFormatOptions): string {
  return day(date).toLocaleDateString('fr-FR', { ...parts, timeZone: 'UTC' });
}

/**
 * Nights of a period, last night included, as the staff says them:
 * « nuit du 10 juillet 2031 », « nuits du 10 au 12 juillet 2031 »,
 * « nuits du 28 juin au 2 juillet 2031 », « nuits du 30 décembre 2031 au 2 janvier 2032 ».
 */
export function formatNights(firstNight: string, lastNight: string): string {
  if (firstNight === lastNight) {
    return `nuit du ${dateText(firstNight, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  const last = dateText(lastNight, { day: 'numeric', month: 'long', year: 'numeric' });
  const sameYear = firstNight.slice(0, 4) === lastNight.slice(0, 4);
  const sameMonth = sameYear && firstNight.slice(5, 7) === lastNight.slice(5, 7);
  let firstParts: Intl.DateTimeFormatOptions = { dateStyle: 'long' };
  if (sameMonth) {
    firstParts = { day: 'numeric' };
  } else if (sameYear) {
    firstParts = { day: 'numeric', month: 'long' };
  }
  const first = dateText(firstNight, firstParts);
  return `nuits du ${first} au ${last}`;
}

/** Number of nights of a period, last night included. */
export function nightCount(firstNight: string, lastNight: string): number {
  return Math.round((day(lastNight).getTime() - day(firstNight).getTime()) / 86_400_000) + 1;
}

// --- Reading what the staff types ---

/**
 * « 95 », « 95,5 », « 95,50 € », « 1 200,00 » → cents. null when it is not an amount
 * with at most two decimals.
 */
export function parseEuros(text: string): number | null {
  const cleaned = text.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  return Math.round(Number(cleaned) * 100);
}

/** « 20 », « -15 », « +35,5 », « 12,5 % » → number. null when not a percentage. */
export function parsePercent(text: string): number | null {
  const cleaned = text.replace(/[\s  %]/g, '').replace(',', '.');
  if (!/^[+-]?\d{1,4}(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

/** « 3 » → 3; null when not a whole number. */
export function parseWhole(text: string): number | null {
  const cleaned = text.trim();
  return /^-?\d{1,6}$/.test(cleaned) ? Number(cleaned) : null;
}
