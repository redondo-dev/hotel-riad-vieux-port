import { addDays } from '../../catalog/domain/pricing.ts';
import type { BookingSource, RatePlan } from './reservation-rules.ts';

/**
 * The stays of the DEMO hotel (portfolio, DEMO_MODE=true only): about forty reservations around
 * the day the demo is loaded, so that the planning, the lists and the reservation pages have
 * something to show. Pure and deterministic: the same day gives the same plan. Fictional
 * customers, addresses @example.com (a domain reserved for examples, RFC 2606).
 */

export type DemoStatus = 'checked_out' | 'checked_in' | 'confirmed' | 'cancelled';

export interface DemoCustomer {
  firstName: string;
  lastName: string;
  email: string;
  preferredLanguage: 'fr' | 'en';
}

export interface DemoStay {
  customer: DemoCustomer;
  categoryCode: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenAges: number[];
  ratePlan: RatePlan;
  source: BookingSource;
  breakfast: boolean;
  /** A room is given; false leaves the stay « to assign ». */
  assigned: boolean;
  status: DemoStatus;
}

/** First day and last departure of the demo, around the day it is loaded. */
export const DEMO_DAYS_BEFORE = 7;
export const DEMO_DAYS_AFTER = 30;

const NAMES: readonly (readonly [string, string, 'fr' | 'en'])[] = [
  ['Camille', 'Martin', 'fr'],
  ['Lucas', 'Bernard', 'fr'],
  ['Léa', 'Dubois', 'fr'],
  ['Hugo', 'Thomas', 'fr'],
  ['Chloé', 'Robert', 'fr'],
  ['Nathan', 'Richard', 'fr'],
  ['Manon', 'Petit', 'fr'],
  ['Théo', 'Durand', 'fr'],
  ['Inès', 'Leroy', 'fr'],
  ['Louis', 'Moreau', 'fr'],
  ['Sarah', 'Simon', 'fr'],
  ['Jules', 'Laurent', 'fr'],
  ['Emma', 'Lefebvre', 'fr'],
  ['Adam', 'Michel', 'fr'],
  ['Jade', 'Garcia', 'fr'],
  ['Yanis', 'Benali', 'fr'],
  ['Lina', 'Haddad', 'fr'],
  ['Gabriel', 'Roux', 'fr'],
  ['Nora', 'Vincent', 'fr'],
  ['Arthur', 'Fournier', 'fr'],
  ['Zoé', 'Girard', 'fr'],
  ['Raphaël', 'Bonnet', 'fr'],
  ['Alice', 'Mercier', 'fr'],
  ['Paul', 'Blanc', 'fr'],
  ['Mila', 'Guerin', 'fr'],
  ['Sacha', 'Faure', 'fr'],
  ['Rose', 'Andre', 'fr'],
  ['Tom', 'Chevalier', 'fr'],
  ['Lou', 'Francois', 'fr'],
  ['Noah', 'Gauthier', 'fr'],
  ['Anna', 'Perrin', 'fr'],
  ['Victor', 'Morel', 'fr'],
  ['Emily', 'Smith', 'en'],
  ['James', 'Taylor', 'en'],
  ['Olivia', 'Brown', 'en'],
  ['William', 'Wilson', 'en'],
  ['Sophie', 'Müller', 'en'],
  ['Marco', 'Rossi', 'en'],
  ['Isabel', 'García', 'en'],
  ['Lars', 'Jensen', 'en'],
];

/** The categories of the demo catalogue, the most frequent first. */
const CATEGORY_CYCLE = [
  'double-standard',
  'double-superior',
  'single',
  'double-standard',
  'family',
  'double-superior',
  'suite',
  'double-standard',
] as const;

/** « léa.dubois@example.com »: accents removed, letters only. */
export function demoEmail(firstName: string, lastName: string): string {
  const plain = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  return `${plain(firstName)}.${plain(lastName)}@example.com`;
}

/** Every demo customer, to know whether the demo stays are loaded already. */
export function demoEmails(): string[] {
  return NAMES.map(([firstName, lastName]) => demoEmail(firstName, lastName));
}

/** Guests of a room of the category, varied by the position in the plan. */
function guestsFor(code: string, index: number): { adults: number; childrenAges: number[] } {
  switch (code) {
    case 'single':
      return { adults: 1, childrenAges: [] };
    case 'family':
      return { adults: 2, childrenAges: index % 2 === 0 ? [8, 5] : [11] };
    case 'suite':
      return { adults: 2, childrenAges: index % 3 === 0 ? [6] : [] };
    default:
      return { adults: index % 5 === 0 ? 1 : 2, childrenAges: [] };
  }
}

/** Arrival (days from `today`), nights and status of the stay at `index`. */
function timingFor(index: number): { from: number; nights: number; status: DemoStatus } {
  if (index < 6) {
    // Over: left between 1 and 5 days ago.
    return { from: -DEMO_DAYS_BEFORE + index, nights: 1 + (index % 2), status: 'checked_out' };
  }
  if (index < 12) {
    // In the hotel tonight: arrived 1 to 3 days ago, leave in 1 to 3 days.
    const before = 1 + (index % 3);
    return { from: -before, nights: before + 1 + (index % 2), status: 'checked_in' };
  }
  if (index < 16) {
    // Arriving today.
    return { from: 0, nights: 1 + (index % 3), status: 'confirmed' };
  }
  const from = 1 + ((index - 16) * 5) % 26;
  return { from, nights: 1 + (index % 4), status: index >= 38 ? 'cancelled' : 'confirmed' };
}

/** The demo stays for a load on `today` (« YYYY-MM-DD », at the hotel). */
export function demoStayPlan(today: string): DemoStay[] {
  return NAMES.map(([firstName, lastName, preferredLanguage], index) => {
    const categoryCode = CATEGORY_CYCLE[index % CATEGORY_CYCLE.length] ?? 'double-standard';
    const { from, nights, status } = timingFor(index);
    const checkIn = addDays(today, from);
    return {
      customer: {
        firstName,
        lastName,
        email: demoEmail(firstName, lastName),
        preferredLanguage,
      },
      categoryCode,
      checkIn,
      checkOut: addDays(checkIn, nights),
      ...guestsFor(categoryCode, index),
      ratePlan: index % 5 === 3 ? 'non_refundable' : 'flexible',
      source: index % 2 === 0 ? 'phone' : 'desk',
      breakfast: index % 3 !== 1,
      // Every stay begun or arriving today has its room; one stay in three to come waits for one.
      assigned: from <= 0 || index % 3 !== 0,
      status,
    };
  });
}
