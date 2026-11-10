import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { CatalogService } from './core/data/catalog.service';
import {
  BOOKING_PATH,
  CHOICE_PATH,
  CONFIRMATION_PATH,
  ROOMS_PATH,
  TERMS_PATH,
} from './core/navigation';
import { PAGE_DESCRIPTION } from './core/seo/page-meta-strategy';
import { searchResolver } from './features/booking/booking-route';
import { confirmationResolver } from './features/booking/confirmation-route';
import {
  categoryDescription,
  categoryExists,
  categoryTitle,
} from './features/category/category-route';

// Pages without a description (search in progress, page not found) are not meant to be
// indexed: PageMetaStrategy removes the description of the previous page.

export const routes: Routes = [
  {
    path: '',
    title: $localize`:@@title.home:Hôtel Riad Vieux-Port · Hôtel 3 étoiles sur le Vieux-Port de Marseille`,
    resolve: {
      [PAGE_DESCRIPTION]: () =>
        $localize`:@@home.metaDescription:Hôtel 3 étoiles de ${inject(CatalogService).totalRooms}:rooms: chambres sur le Vieux-Port de Marseille. Réservation en ligne, annulation gratuite jusqu'à 48 h avec le tarif flexible, réception 24 h/24.`,
    },
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: BOOKING_PATH,
    title: $localize`:@@title.booking:Votre recherche · Hôtel Riad Vieux-Port`,
    // The availability is read before the page is shown, again at each new search.
    resolve: { search: searchResolver },
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    loadComponent: () =>
      import('./features/booking/booking-results-page').then((m) => m.BookingResultsPage),
  },
  {
    path: `${BOOKING_PATH}/${CHOICE_PATH}`,
    title: $localize`:@@title.bookingChoice:Finaliser votre réservation · Hôtel Riad Vieux-Port`,
    resolve: { search: searchResolver },
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    loadComponent: () =>
      import('./features/booking/booking-choice-page').then((m) => m.BookingChoicePage),
  },
  {
    path: `${BOOKING_PATH}/${CONFIRMATION_PATH}`,
    title: $localize`:@@title.bookingConfirmation:Votre réservation · Hôtel Riad Vieux-Port`,
    resolve: { data: confirmationResolver },
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    loadComponent: () =>
      import('./features/booking/booking-confirmation-page').then((m) => m.BookingConfirmationPage),
  },
  {
    path: TERMS_PATH,
    title: $localize`:@@title.terms:Conditions de vente et d'annulation · Hôtel Riad Vieux-Port`,
    resolve: {
      [PAGE_DESCRIPTION]: () =>
        $localize`:@@terms.metaDescription:Tarifs, annulation, non-présentation, paiement et taxe de séjour de l'Hôtel Riad Vieux-Port, à Marseille.`,
    },
    loadComponent: () => import('./features/legal/terms-page').then((m) => m.TermsPage),
  },
  {
    path: `${ROOMS_PATH}/:code`,
    canMatch: [categoryExists],
    title: categoryTitle,
    resolve: { [PAGE_DESCRIPTION]: categoryDescription },
    loadComponent: () => import('./features/category/category-page').then((m) => m.CategoryPage),
  },
  {
    path: '**',
    title: $localize`:@@title.notFound:Page introuvable · Hôtel Riad Vieux-Port`,
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
