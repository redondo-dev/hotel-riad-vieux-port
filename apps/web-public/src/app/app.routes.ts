import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { CatalogService } from './core/data/catalog.service';
import { BOOKING_PATH, ROOMS_PATH } from './core/navigation';
import { PAGE_DESCRIPTION } from './core/seo/page-meta-strategy';
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
    loadComponent: () =>
      import('./features/booking/booking-in-progress-page').then((m) => m.BookingInProgressPage),
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
