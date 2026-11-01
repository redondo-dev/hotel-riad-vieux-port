import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CatalogService } from './core/data/catalog.service';
import { UnavailablePage } from './features/unavailable/unavailable-page';
import { SiteFooter } from './layout/site-footer';
import { SiteHeader } from './layout/site-header';

@Component({
  selector: 'rvp-root',
  imports: [RouterOutlet, SiteHeader, SiteFooter, UnavailablePage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available) {
      <!-- A plain href="#main" would follow the <base href> and reload the home page. -->
      <a class="skip-link" href="#main" (click)="skipToMain($event)" i18n="@@app.skipToContent"
        >Aller au contenu</a
      >
      <rvp-site-header />
      <main id="main" tabindex="-1" class="outline-none">
        <router-outlet />
      </main>
      <rvp-site-footer />
    } @else {
      <rvp-unavailable-page />
    }
  `,
})
export class App {
  private readonly document = inject(DOCUMENT);

  /** False when the server has no catalogue to show (API never reached): see CatalogService. */
  protected readonly available = inject(CatalogService).available;

  constructor() {
    if (!this.available) {
      // On the server: « 503 Service Unavailable », so that the page is not indexed.
      const response = inject(RESPONSE_INIT, { optional: true });
      if (response) {
        response.status = 503;
      }
    }
  }

  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }
}
