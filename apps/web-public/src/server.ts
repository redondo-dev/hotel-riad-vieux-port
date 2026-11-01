import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import helmet from 'helmet';
import { join } from 'node:path';

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
 */
const browserDistFolder = join(import.meta.dirname, '../browser');

const allowedHosts = (process.env['ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter((host) => host !== '');

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
        // The API origin will be added here when the site calls it (catalogue module).
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
  angularApp
    .handle(req)
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
