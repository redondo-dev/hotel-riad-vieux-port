import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import {
  fromSearchQueryParams,
  nowInTimeZone,
  serializeGuests,
  type StaySearchCriteria,
  validateStaySearch,
} from '@riad/shared';
import { availabilityReader } from '../../core/booking/availability-reader';
import type { AvailabilityResult } from '../../core/booking/availability-result';
import { CatalogService } from '../../core/data/catalog.service';
import { staySearchErrorMessage } from '../../shared/ui/stay-search/stay-search-messages';

/** What the results page and the choice page need, read before they are shown. */
export interface SearchPageData {
  /** null: the address does not hold a complete search. */
  criteria: StaySearchCriteria | null;
  /** Rules broken by the search (date passed…), already translated; then no availability. */
  problems: string[];
  /** null when the availability was not asked (no search, or rules broken). */
  result: AvailabilityResult | null;
}

/**
 * Reads the search of the address, checks it against the online rules (the same ones as the
 * form, from @riad/shared), then the availability: on the server for the first display, in the
 * browser for a new search made on the page.
 */
export const searchResolver: ResolveFn<SearchPageData> = async (route) => {
  const catalog = inject(CatalogService);
  const read = availabilityReader();
  const criteria = fromSearchQueryParams((name) => route.queryParamMap.get(name));
  if (criteria === null) {
    return { criteria, problems: [], result: null };
  }
  const rules = catalog.bookingRules;
  const now = nowInTimeZone(catalog.hotel.timeZone);
  const context = {
    maxStayNights: rules.maxStayNights,
    bookingHorizonDays: rules.bookingHorizonDays,
    phone: catalog.hotel.phone.display,
  };
  const problems = validateStaySearch(criteria, rules, now).map((error) =>
    staySearchErrorMessage(error, context),
  );
  if (problems.length > 0) {
    return { criteria, problems, result: null };
  }
  const result = await read({
    checkIn: criteria.checkIn,
    checkOut: criteria.checkOut,
    guests: serializeGuests(criteria.rooms),
  });
  return { criteria, problems: [], result };
};
