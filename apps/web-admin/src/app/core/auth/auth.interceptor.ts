import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ADMIN_API } from '../api/api';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every call to the staff API:
 *  - carries the session cookie (`withCredentials`);
 *  - carries the anti-CSRF token when it changes data;
 *  - when the server answers 401 (session expired, account deactivated…), forgets the session
 *    and goes back to the login page, then to the current page once logged in again.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(ADMIN_API);
  if (!request.url.startsWith(api)) {
    return next(request);
  }
  const session = inject(SessionService);
  const router = inject(Router);

  const token = session.csrf();
  const prepared = request.clone({
    withCredentials: true,
    ...(token !== null && !SAFE_METHODS.has(request.method)
      ? { setHeaders: { 'X-CSRF-Token': token } }
      : {}),
  });

  // Login and session check answer 401 as a normal result: the screens handle them.
  const isSessionCall = request.url === `${api}/session` && request.method !== 'DELETE';

  return next(prepared).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isSessionCall) {
        session.clear();
        void router.navigate(['/connexion'], { queryParams: { retour: router.url } });
      }
      return throwError(() => error);
    }),
  );
};
