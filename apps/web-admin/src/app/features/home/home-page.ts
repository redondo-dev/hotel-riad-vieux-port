import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ROLE_LABELS } from '../../core/auth/roles';
import { SessionService } from '../../core/auth/session.service';

/**
 * PROVISIONAL home page, the landing screen of every role until the dashboard (management),
 * « Aujourd'hui » (reception), housekeeping and incidents exist.
 */
@Component({
  selector: 'adm-home-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card max-w-3xl p-6">
      <h2 class="text-xl font-semibold">Bonjour {{ firstName() }}</h2>
      <p class="mt-1 text-muted">Vous êtes connecté avec le rôle {{ roleLabel() }}.</p>
      <p class="mt-4">
        L’outil de gestion s’enrichit module par module. Les écrans du quotidien (planning, arrivées
        et départs, pannes, tableau de bord) apparaîtront dans le menu dès qu’ils seront
        disponibles.
      </p>
      <ul class="mt-4 flex flex-wrap gap-3">
        @if (isManager()) {
          <li><a routerLink="/utilisateurs" class="btn-secondary">Gérer les utilisateurs</a></li>
        }
        <li><a routerLink="/mon-compte" class="btn-secondary">Mon compte</a></li>
      </ul>
    </section>
  `,
})
export class HomePage {
  private readonly session = inject(SessionService);

  protected readonly firstName = computed(() => this.session.user()?.firstName ?? '');
  protected readonly roleLabel = computed(() => {
    const user = this.session.user();
    return user === null ? '' : ROLE_LABELS[user.role].toLowerCase();
  });
  protected readonly isManager = computed(() => this.session.user()?.role === 'direction');
}
