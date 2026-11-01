import { RenderMode, type ServerRoute } from '@angular/ssr';

/**
 * Every page is rendered on the server at request time, with the catalogue read from the API
 * (prices and rules change without rebuilding the site).
 */
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Server }];
