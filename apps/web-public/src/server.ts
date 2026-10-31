import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

/**
 * Server-side rendering of the public site: pages arrive already filled in, which search
 * engines read correctly. With i18n, `/fr/…` and `/en/…` are served by the same server.
 * Security headers (Helmet) will be added with the API in a later phase.
 */
const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

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
