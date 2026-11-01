import type { Role } from '../../identity/domain/identity-rules.ts';

/**
 * Rules of the catalogue management (module 5, decisions validated on 1 November 2026):
 *  - the management changes everything; the reception reads everything and manages the sales
 *    closures (a group at the last minute, for example); housekeeping and technicians have no
 *    access;
 *  - a category, a room or a service is never deleted, only deactivated: reservations and
 *    invoices refer to them. Rate periods and sales closures can be deleted;
 *  - the code of a category never changes: it appears in the addresses of the public site.
 */

export const CATALOG_READ_ROLES: readonly Role[] = ['direction', 'reception'];
export const CATALOG_WRITE_ROLES: readonly Role[] = ['direction'];
export const SALES_CLOSURE_ROLES: readonly Role[] = ['direction', 'reception'];

/** Equipment shown on the room cards; the public site has a label for each one. */
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

export const PRICING_UNITS = ['per_person_night', 'per_night', 'per_stay', 'per_unit'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const RATE_PERIOD_KINDS = ['season', 'event'] as const;
export type RatePeriodKind = (typeof RATE_PERIOD_KINDS)[number];

/** Highest price accepted for a night or an option: 10 000 €, against typing mistakes. */
export const MAX_PRICE_CENTS = 1_000_000;

/** A rate period or a sales closure lasts at most this many nights (about three years). */
export const MAX_PERIOD_NIGHTS = 1100;

/** Rate increase accepted at most (+1 000 %), against typing mistakes. */
export const MAX_ADJUSTMENT_PCT = 1000;
