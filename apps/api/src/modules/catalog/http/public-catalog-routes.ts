import { type Response, Router } from 'express';
import type { PublicCatalog } from '../application/public-catalog.ts';

/**
 * Public routes of the catalogue, under /api/v1/public (architecture, section 5). Read only, no
 * session, no personal data:
 *
 *   GET /hotel             name, address, contact, times and online booking rules
 *   GET /room-categories   categories that can be booked, with their « from » price
 *   GET /services          options that can be added when booking online
 */

/**
 * Shared caches (browsers, CDN) may keep the answer 5 minutes: a price change is visible on the
 * site within 5 minutes, and the database is spared one query per visitor.
 */
export const PUBLIC_CATALOG_MAX_AGE_SECONDS = 300;

function cacheable(res: Response): void {
  res.set('Cache-Control', `public, max-age=${PUBLIC_CATALOG_MAX_AGE_SECONDS}`);
}

export function publicCatalogRouter(catalog: PublicCatalog): Router {
  const router = Router();

  router.get('/hotel', async (_req, res) => {
    const hotel = await catalog.hotel();
    cacheable(res);
    res.json(hotel);
  });

  router.get('/room-categories', async (_req, res) => {
    const items = await catalog.categories();
    cacheable(res);
    res.json({ items });
  });

  router.get('/services', async (_req, res) => {
    const items = await catalog.services();
    cacheable(res);
    res.json({ items });
  });

  return router;
}
