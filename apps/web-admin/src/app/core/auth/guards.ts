import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { isRole, landingFor } from './roles';
import { SessionService } from './session.service';

/** Logged-in staff only; otherwise the login page, then back here. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const user = await inject(SessionService)
    .ensureLoaded()
    .catch(() => null);
  return user === null
    ? router.createUrlTree(['/connexion'], { queryParams: { retour: state.url } })
    : true;
};

/** Only the roles listed in the route data (`data: { roles: [...] }`); otherwise the home page. */
export const roleGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const user = inject(SessionService).user();
  const allowed: unknown = route.data['roles'];
  if (user === null) {
    return router.createUrlTree(['/connexion']);
  }
  if (Array.isArray(allowed) && allowed.filter(isRole).includes(user.role)) {
    return true;
  }
  return router.createUrlTree([landingFor(user.role)]);
};

/** The login and password pages are pointless once logged in: go to the home page. */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const user = await inject(SessionService)
    .ensureLoaded()
    .catch(() => null);
  return user === null ? true : router.createUrlTree([landingFor(user.role)]);
};
