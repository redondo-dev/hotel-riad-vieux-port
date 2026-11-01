import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert, LucidePencil } from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { CatalogApi } from './catalog-api';
import { type Category, canEditCatalog, formatEuros } from './catalog-model';

/**
 * Room categories (UI/UX specification, section 5.K): every category, inactive ones included,
 * with capacity, base price and rooms. The management opens a category to change it; the
 * reception only reads.
 */
@Component({
  selector: 'adm-categories-page',
  imports: [RouterLink, LucidePencil, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (problem(); as error) {
      <div class="alert-error" role="alert">
        <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
        <div>
          <p>
            <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
          </p>
          <button type="button" class="-ml-3 btn-quiet" (click)="load()">Réessayer</button>
        </div>
      </div>
    } @else if (loading()) {
      <p class="text-muted" role="status">Chargement des catégories…</p>
    } @else {
      <p class="mb-4 text-muted">
        Prix de base : une nuit au tarif flexible, hors saison et événement.
      </p>
      <div class="card overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">
            Catégories de chambres
          </caption>
          <thead class="border-b border-line text-muted">
            <tr>
              <th scope="col" class="px-4 py-3 font-semibold">Catégorie</th>
              <th scope="col" class="px-4 py-3 font-semibold">Capacité</th>
              <th scope="col" class="px-4 py-3 font-semibold">Prix de base</th>
              <th scope="col" class="px-4 py-3 font-semibold">Chambres actives</th>
              <th scope="col" class="px-4 py-3 font-semibold">Statut</th>
              @if (canEdit()) {
                <th scope="col" class="px-4 py-3 font-semibold">
                  <span class="sr-only">Actions</span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (category of categories(); track category.id) {
              <tr class="border-b border-line last:border-0">
                <td class="px-4 py-3">
                  <span class="block font-semibold">{{ category.name.fr }}</span>
                  <span class="block text-muted">{{ category.code }}</span>
                </td>
                <td class="px-4 py-3">
                  {{ category.maxOccupancy }} pers. ({{ category.baseOccupancy }} comprises)
                </td>
                <td class="px-4 py-3 whitespace-nowrap">{{ euros(category.basePriceCents) }}</td>
                <td class="px-4 py-3">{{ category.activeRoomCount }} / {{ category.roomCount }}</td>
                <td class="px-4 py-3">
                  @if (category.isActive) {
                    <span class="badge-ok">Active</span>
                  } @else {
                    <span class="badge-off">Désactivée</span>
                  }
                </td>
                @if (canEdit()) {
                  <td class="px-4 py-3 text-right">
                    <a [routerLink]="['/catalogue/categories', category.id]" class="btn-secondary">
                      <svg lucidePencil></svg>
                      Modifier
                      <span class="sr-only">{{ category.name.fr }}</span>
                    </a>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class CategoriesPage {
  private readonly catalog = inject(CatalogApi);
  private readonly session = inject(SessionService);

  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);
  protected readonly canEdit = computed(() => canEditCatalog(this.session.user()?.role));

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    try {
      this.categories.set(await this.catalog.categories());
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }
}
