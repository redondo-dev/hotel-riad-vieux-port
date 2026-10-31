import { ChangeDetectionStrategy, Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StaySearch } from '../../shared/ui/stay-search/stay-search';

/** 404 page (UI/UX specification 4.I). On the server, the response gets the 404 status. */
@Component({
  selector: 'rvp-not-found-page',
  imports: [RouterLink, StaySearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-page max-w-4xl py-12 sm:py-16">
      <p class="font-semibold text-clay" i18n="@@notFound.code">Erreur 404</p>
      <h1 class="mt-2 font-display text-h1-m font-semibold sm:text-h1" i18n="@@notFound.title">
        Cette page n'existe pas ou a été déplacée
      </h1>
      <p class="mt-4 max-w-2xl" i18n="@@notFound.text">
        Vous pouvez lancer une recherche de séjour ci-dessous ou revenir à l'accueil.
      </p>
      <div class="mt-8">
        <rvp-stay-search idPrefix="not-found-search" />
      </div>
      <a class="btn-secondary mt-8" routerLink="/" i18n="@@notFound.home">Retour à l'accueil</a>
    </div>
  `,
})
export class NotFoundPage {
  constructor() {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) {
      response.status = 404;
    }
  }
}
