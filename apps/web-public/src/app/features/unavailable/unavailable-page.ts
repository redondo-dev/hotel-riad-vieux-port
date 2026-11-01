import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Logo } from '../../shared/ui/logo';

/**
 * Shown instead of the whole site when the server could not read the catalogue from the API
 * (never since it started, or for more than 24 hours). The status of the response is 503: search
 * engines come back later instead of indexing this page.
 */
@Component({
  selector: 'rvp-unavailable-page',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main" class="container-page max-w-3xl py-16 sm:py-24">
      <rvp-logo />
      <h1 class="mt-10 font-display text-h1-m font-semibold sm:text-h1" i18n="@@unavailable.title">
        Site momentanément indisponible
      </h1>
      <p class="mt-4 max-w-2xl" i18n="@@unavailable.text">
        Nos informations ne peuvent pas être affichées pour le moment. Réessayez dans quelques
        minutes.
      </p>
    </main>
  `,
})
export class UnavailablePage {}
