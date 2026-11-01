import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { CatalogSource } from './catalog-source';

/**
 * Server-side rendering of the public site: pages arrive already filled in, which search
 * engines read correctly. With i18n, `/fr/…` and `/en/…` are served by the same server.
 *
 * Security (audit QA, risk R5):
 *  - only the host names listed in ALLOWED_HOSTS are served (protection against forged Host
 *    headers); the list is mandatory in production, optional in development;
 *  - security headers (Helmet). The content security policy is in REPORT-ONLY mode for now:
 *    the browser reports violations in its console without blocking anything. It will be
 *    enforced once checked in a browser on the built site, so that it cannot break hydration.
 *
 * Catalogue: read from the API by this server (API_INTERNAL_URL) and handed to each page
 * through the request context; the visitor's browser never calls the API (see
 * catalog-source.ts for the memory and the behaviour when the API is down).
 */
const browserDistFolder = join(import.meta.dirname, '../browser');

const allowedHosts = (process.env['ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter((host) => host !== '');

const catalog = new CatalogSource({
  // An empty value (copied from .env.example) means « not set ».
  apiUrl: process.env['API_INTERNAL_URL'] || 'http://localhost:3000/api/v1',
  onError: (error) => {
    // eslint-disable-next-line no-console -- the SSR server has no logger yet
    console.error('Catalogue : lecture de l’API impossible.', error);
  },
});

const app = express();
const angularApp = new AngularNodeAppEngine();

app.disable('x-powered-by');

app.use((req, res, next) => {
  // Express gives no host name when the Host header is missing.
  const host = (req.hostname as string | undefined)?.toLowerCase() ?? '';
  if (allowedHosts.length === 0 || allowedHosts.includes(host)) {
    next();
    return;
  }
  res.status(400).type('text/plain').send('Hôte non autorisé.');
});

app.use(
  helmet({
    contentSecurityPolicy: {
      reportOnly: true,
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        // Angular inlines the critical CSS and the component styles in the rendered page.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        // The browser never calls the API: the catalogue comes with the page.
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
  }),
);

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  catalog
    .get()
    .then((snapshot) => angularApp.handle(req, { catalog: snapshot }))
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  if (process.env['NODE_ENV'] === 'production' && allowedHosts.length === 0) {
    // eslint-disable-next-line no-console -- the server refuses to start, nothing to log into yet
    console.error('ALLOWED_HOSTS est obligatoire en production (noms de domaine du site).');
    process.exit(1);
  }
  const port = process.env['PORT'] ?? 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }
    // eslint-disable-next-line no-console -- startup message of the local SSR server
    console.log(`Site public disponible sur http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
