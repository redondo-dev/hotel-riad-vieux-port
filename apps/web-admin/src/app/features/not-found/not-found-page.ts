import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'adm-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card max-w-xl p-6">
      <h2 class="text-xl font-semibold">Cette page n’existe pas</h2>
      <p class="mt-2 text-muted">
        L’adresse est peut-être incomplète, ou l’écran n’existe pas encore.
      </p>
      <a routerLink="/" class="mt-4 btn-secondary">Retour à l’accueil</a>
    </section>
  `,
})
export class NotFoundPage {}
