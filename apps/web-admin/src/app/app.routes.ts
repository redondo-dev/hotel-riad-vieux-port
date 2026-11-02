import type { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/guards';

const TITLE = 'Gestion · Hôtel Riad Vieux-Port';

export const routes: Routes = [
  // --- Without session ---
  {
    path: 'connexion',
    title: `Connexion · ${TITLE}`,
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'mot-de-passe-oublie',
    title: `Mot de passe oublié · ${TITLE}`,
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/password/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    // Link of the e-mails: /mot-de-passe#jeton=… (works logged in or not).
    path: 'mot-de-passe',
    title: `Choisir un mot de passe · ${TITLE}`,
    loadComponent: () =>
      import('./features/password/reset-password-page').then((m) => m.ResetPasswordPage),
  },

  // --- Staff tool (session required) ---
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accueil' },
      {
        path: 'accueil',
        title: `Accueil · ${TITLE}`,
        data: { heading: 'Accueil' },
        loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
      },
      {
        path: 'menage',
        title: `Ménage · ${TITLE}`,
        data: { heading: 'Ménage', roles: ['direction', 'reception', 'housekeeping'] },
        canActivate: [roleGuard],
        loadComponent: () =>
          import('./features/housekeeping/housekeeping-page').then((m) => m.HousekeepingPage),
      },
      {
        path: 'pannes',
        title: `Pannes · ${TITLE}`,
        data: { heading: 'Pannes' },
        loadComponent: () =>
          import('./features/incidents/incidents-page').then((m) => m.IncidentsPage),
      },
      {
        path: 'pannes/:id',
        title: `Panne · ${TITLE}`,
        data: { heading: 'Pannes' },
        loadComponent: () =>
          import('./features/incidents/incident-page').then((m) => m.IncidentPage),
      },
      {
        path: 'catalogue',
        data: { heading: 'Catalogue', roles: ['direction', 'reception'] },
        canActivate: [roleGuard],
        loadComponent: () =>
          import('./features/catalog/catalog-layout').then((m) => m.CatalogLayout),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'categories' },
          {
            path: 'categories',
            title: `Catégories · ${TITLE}`,
            loadComponent: () =>
              import('./features/catalog/categories-page').then((m) => m.CategoriesPage),
          },
          {
            path: 'categories/:id',
            title: `Modifier une catégorie · ${TITLE}`,
            data: { roles: ['direction'] },
            canActivate: [roleGuard],
            loadComponent: () =>
              import('./features/catalog/category-edit-page').then((m) => m.CategoryEditPage),
          },
          {
            path: 'chambres',
            title: `Chambres · ${TITLE}`,
            loadComponent: () => import('./features/catalog/rooms-page').then((m) => m.RoomsPage),
          },
          {
            path: 'tarifs',
            title: `Tarifs · ${TITLE}`,
            loadComponent: () => import('./features/catalog/rates-page').then((m) => m.RatesPage),
          },
          {
            path: 'services',
            title: `Services · ${TITLE}`,
            loadComponent: () =>
              import('./features/catalog/services-page').then((m) => m.ServicesPage),
          },
        ],
      },
      {
        path: 'utilisateurs',
        title: `Utilisateurs · ${TITLE}`,
        data: { heading: 'Utilisateurs', roles: ['direction'] },
        canActivate: [roleGuard],
        loadComponent: () => import('./features/users/users-page').then((m) => m.UsersPage),
      },
      {
        path: 'mon-compte',
        title: `Mon compte · ${TITLE}`,
        data: { heading: 'Mon compte' },
        loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
      },
      {
        path: '**',
        title: `Page introuvable · ${TITLE}`,
        data: { heading: 'Page introuvable' },
        loadComponent: () =>
          import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
