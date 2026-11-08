import { inject } from '@angular/core';
import type { CanMatchFn, ResolveFn } from '@angular/router';
import { type CategoryView, CatalogService } from '../../core/data/catalog.service';
import { guestsUpToLabel } from '../../core/i18n/counts';
import { formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';

/*
 * The page of a room category: `/fr/chambres/<code>`. An unknown code (or an inactive
 * category, which the API does not give) does not match: the « page not found » answers, with
 * the 404 status.
 */

function categoryOf(code: string | null | undefined): CategoryView | undefined {
  return inject(CatalogService).categories.find((category) => category.code === code);
}

/** `segments`: « chambres », then the code. */
export const categoryExists: CanMatchFn = (_route, segments) =>
  categoryOf(segments[1]?.path) !== undefined;

export const categoryTitle: ResolveFn<string> = (route) => {
  const name = categoryOf(route.paramMap.get('code'))?.name ?? '';
  return $localize`:@@title.category:${name}:name: · Hôtel Riad Vieux-Port`;
};

export const categoryDescription: ResolveFn<string> = (route) => {
  const category = categoryOf(route.paramMap.get('code'));
  if (category === undefined) {
    return '';
  }
  const guests = guestsUpToLabel(category.maxOccupancy);
  const price = formatPrice(category.fromPriceCents, injectLocale());
  return $localize`:@@category.metaDescription:${category.name}:name: à l'Hôtel Riad Vieux-Port, sur le Vieux-Port de Marseille. ${guests}:guests:, ${category.areaSqm}:area: m². À partir de ${price}:price: la nuit.`;
};
