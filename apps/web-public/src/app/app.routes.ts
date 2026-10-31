import type { Routes } from '@angular/router';
import { BOOKING_PATH } from './core/navigation';

export const routes: Routes = [
  {
    path: '',
    title: $localize`:@@title.home:Hôtel Riad Vieux-Port · Hôtel 3 étoiles sur le Vieux-Port de Marseille`,
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: BOOKING_PATH,
    title: $localize`:@@title.booking:Votre recherche · Hôtel Riad Vieux-Port`,
    loadComponent: () =>
      import('./features/booking/booking-in-progress-page').then((m) => m.BookingInProgressPage),
  },
  {
    path: '**',
    title: $localize`:@@title.notFound:Page introuvable · Hôtel Riad Vieux-Port`,
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
