import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteFooter } from './layout/site-footer';
import { SiteHeader } from './layout/site-header';

@Component({
  selector: 'rvp-root',
  imports: [RouterOutlet, SiteHeader, SiteFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- A plain href="#main" would follow the <base href> and reload the home page. -->
    <a class="skip-link" href="#main" (click)="skipToMain($event)" i18n="@@app.skipToContent"
      >Aller au contenu</a
    >
    <rvp-site-header />
    <main id="main" tabindex="-1" class="outline-none">
      <router-outlet />
    </main>
    <rvp-site-footer />
  `,
})
export class App {
  private readonly document = inject(DOCUMENT);

  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }
}
