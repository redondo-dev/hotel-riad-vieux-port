import { InjectionToken } from '@angular/core';

/**
 * Base address of the staff routes of the API. Relative: in development the Angular server
 * forwards /api to the API (proxy.conf.json), so the browser sees one single site. In
 * production the hosting must do the same (or this value will be set at deployment).
 */
export const ADMIN_API = new InjectionToken<string>('ADMIN_API', {
  providedIn: 'root',
  factory: () => '/api/v1/admin',
});
