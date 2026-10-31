import { RenderMode, type ServerRoute } from '@angular/ssr';

/**
 * Every page is rendered on the server at request time. The home page could later be
 * prerendered at build time, once its content no longer depends on demo data.
 */
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Server }];
