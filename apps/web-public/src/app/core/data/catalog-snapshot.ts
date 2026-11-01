import { isPlatformServer } from '@angular/common';
import { inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import type { CatalogSnapshot } from '@riad/shared';

/** Key of the catalogue in the state sent with the page (TransferState). */
const CATALOG_KEY = makeStateKey<CatalogSnapshot | null>('catalogue');

/**
 * The catalogue of the page being displayed (must be called in an injection context):
 *  - on the server, the one read from the API by server.ts and given as request context; it is
 *    then written into the page, so that the browser does not ask for it again;
 *  - in the browser, the one written into the page by the server.
 * null when the site has no catalogue to display (API never reached).
 */
export function readCatalogSnapshot(): CatalogSnapshot | null {
  const transferState = inject(TransferState);
  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return transferState.get(CATALOG_KEY, null);
  }
  const context: unknown = inject(REQUEST_CONTEXT, { optional: true });
  const snapshot =
    typeof context === 'object' && context !== null && 'catalog' in context
      ? (context.catalog as CatalogSnapshot | null)
      : null;
  transferState.set(CATALOG_KEY, snapshot);
  return snapshot;
}
