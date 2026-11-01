import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideCircleAlert, LucidePencil, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { CatalogApi } from './catalog-api';
import {
  canEditCatalog,
  canManageClosures,
  type Category,
  formatNights,
  formatPercent,
  parsePercent,
  percentInputValue,
  RATE_PERIOD_KIND_LABELS,
  type RatePeriod,
  type RatePeriodKind,
  type SalesClosure,
} from './catalog-model';

interface PeriodDraft {
  name: string;
  kind: RatePeriodKind;
  firstNight: string;
  lastNight: string;
  adjustment: string;
  /** '' for every category. */
  categoryId: string;
}

interface ClosureDraft {
  categoryId: string;
  firstNight: string;
  lastNight: string;
  reason: string;
}

/** A deletion waiting for its confirmation. */
interface Removal {
  title: string;
  text: string;
  button: string;
  run: () => Promise<void>;
}

const EMPTY_PERIOD: PeriodDraft = {
  name: '',
  kind: 'season',
  firstNight: '',
  lastNight: '',
  adjustment: '',
  categoryId: '',
};

/**
 * Rates (UI/UX specification, section 5.K): seasons and events that change the base price, and
 * sales closures of a category. Nights are typed as the first and the last one, both included.
 * The management changes the periods; the management and the reception close or reopen sales.
 */
@Component({
  selector: 'adm-rates-page',
  imports: [LucidePlus, LucidePencil, LucideTrash2, LucideCircleAlert],
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
      <p class="text-muted" role="status">Chargement des tarifs…</p>
    } @else {
      <div class="flex max-w-4xl flex-col gap-8">
        <section aria-labelledby="titre-periodes" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titre-periodes" class="text-lg font-semibold">Saisons et événements</h2>
            @if (canEdit()) {
              <button type="button" class="btn-primary" (click)="openPeriod(null)">
                <svg lucidePlus></svg>
                Ajouter une période
              </button>
            }
          </div>
          <p class="text-sm text-muted">Un événement l’emporte toujours sur une saison.</p>
          <p class="text-sm text-muted">
            Une période d’une seule catégorie l’emporte sur une période de toutes les catégories.
          </p>
          <label class="flex min-h-11 items-center gap-3 self-start">
            <input
              type="checkbox"
              class="size-5 accent-port"
              [checked]="includePast()"
              (change)="togglePast()"
            />
            Afficher aussi les périodes passées
          </label>
          <ul class="flex flex-col gap-3" aria-label="Saisons et événements">
            @for (entry of periods(); track entry.id) {
              <li class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">
                    {{ entry.name }}
                    <span class="badge-neutral text-sm">{{ kindLabel(entry.kind) }}</span>
                  </p>
                  <p class="text-sm">
                    {{ nights(entry.firstNight, entry.lastNight) }} ·
                    <span class="font-semibold">{{ percent(entry.adjustmentPct) }}</span> ·
                    {{ scopeOf(entry.categoryId) }}
                  </p>
                </div>
                @if (canEdit()) {
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn-quiet" (click)="openPeriod(entry)">
                      <svg lucidePencil></svg>
                      Modifier
                      <span class="sr-only">{{ entry.name }}</span>
                    </button>
                    <button type="button" class="btn-quiet" (click)="askRemovePeriod(entry)">
                      <svg lucideTrash2></svg>
                      Supprimer
                      <span class="sr-only">{{ entry.name }}</span>
                    </button>
                  </div>
                }
              </li>
            } @empty {
              <li class="text-muted">Aucune période : le prix de base s’applique toute l’année.</li>
            }
          </ul>
        </section>

        <section aria-labelledby="titre-fermetures" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titre-fermetures" class="text-lg font-semibold">Fermetures de vente</h2>
            @if (canClose()) {
              <button type="button" class="btn-primary" (click)="openClosure()">
                <svg lucidePlus></svg>
                Fermer à la vente
              </button>
            }
          </div>
          <p class="text-sm text-muted">
            Une catégorie fermée n’est plus vendue ces nuits-là, ni en ligne ni à la réception.
          </p>
          <ul class="flex flex-col gap-3" aria-label="Fermetures de vente">
            @for (item of closures(); track item.id) {
              <li class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{{ categoryName(item.categoryId) }}</p>
                  <p class="text-sm">{{ nights(item.firstNight, item.lastNight) }}</p>
                  @if (item.reason) {
                    <p class="text-sm text-muted">Motif : {{ item.reason }}</p>
                  }
                  @if (item.createdBy; as author) {
                    <p class="text-sm text-muted">
                      Par {{ author.firstName }} {{ author.lastName }}
                    </p>
                  }
                </div>
                @if (canClose()) {
                  <button type="button" class="btn-quiet" (click)="askRemoveClosure(item)">
                    Rouvrir à la vente
                    <span class="sr-only">{{ categoryName(item.categoryId) }}</span>
                  </button>
                }
              </li>
            } @empty {
              <li class="text-muted">Aucune fermeture en cours ou à venir.</li>
            }
          </ul>
        </section>
      </div>
    }

    <!-- Season or event -->
    <dialog
      #periodDialog
      class="dialog-panel"
      aria-labelledby="titre-periode"
      (close)="formProblem.set(null)"
    >
      <form
        class="flex flex-col gap-5 p-6"
        novalidate
        (submit)="$event.preventDefault(); savePeriod()"
      >
        <h2 id="titre-periode" class="text-lg font-semibold">
          {{ editingPeriod() === null ? 'Ajouter une période' : 'Modifier la période' }}
        </h2>
        @if (formProblem(); as error) {
          @if (error.errors.length === 0) {
            <div class="alert-error" role="alert">
              <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
              <p>
                <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
              </p>
            </div>
          }
        }
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="periode-nom">Nom</label>
          <input
            id="periode-nom"
            class="field-control"
            autocomplete="off"
            [attr.aria-invalid]="error('name') ? true : null"
            [value]="period().name"
            (input)="patchPeriod({ name: valueOf($event) })"
          />
          @if (error('name'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="periode-type">Type</label>
            <select id="periode-type" class="field-control" (change)="kindOf($event)">
              <option value="season" [selected]="period().kind === 'season'">Saison</option>
              <option value="event" [selected]="period().kind === 'event'">Événement</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="periode-variation">Variation du prix (%)</label>
            <input
              id="periode-variation"
              class="field-control"
              inputmode="decimal"
              autocomplete="off"
              aria-describedby="periode-variation-aide"
              [attr.aria-invalid]="error('adjustmentPct') ? true : null"
              [value]="period().adjustment"
              (input)="patchPeriod({ adjustment: valueOf($event) })"
            />
            <p id="periode-variation-aide" class="text-sm text-muted">
              Par exemple 20 pour +20 %, -15 pour une remise.
            </p>
            @if (error('adjustmentPct'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="periode-debut">Première nuit</label>
            <input
              id="periode-debut"
              type="date"
              class="field-control"
              [attr.aria-invalid]="error('firstNight') ? true : null"
              [value]="period().firstNight"
              (input)="patchPeriod({ firstNight: valueOf($event) })"
            />
            @if (error('firstNight'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="periode-fin">Dernière nuit (incluse)</label>
            <input
              id="periode-fin"
              type="date"
              class="field-control"
              [attr.aria-invalid]="error('lastNight') ? true : null"
              [value]="period().lastNight"
              (input)="patchPeriod({ lastNight: valueOf($event) })"
            />
            @if (error('lastNight'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="periode-portee">Catégories concernées</label>
          <select
            id="periode-portee"
            class="field-control"
            [attr.aria-invalid]="error('categoryId') ? true : null"
            (change)="patchPeriod({ categoryId: valueOf($event) })"
          >
            <option value="" [selected]="period().categoryId === ''">Toutes les catégories</option>
            @for (category of categories(); track category.id) {
              <option [value]="category.id" [selected]="period().categoryId === category.id">
                {{ category.name.fr }}
              </option>
            }
          </select>
          @if (error('categoryId'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="flex flex-wrap justify-end gap-3">
          <button type="button" class="btn-quiet" (click)="periodDialog.close()">Retour</button>
          <button type="submit" class="btn-primary" [disabled]="saving()">
            {{ editingPeriod() === null ? 'Ajouter' : 'Enregistrer' }}
          </button>
        </div>
      </form>
    </dialog>

    <!-- Sales closure -->
    <dialog
      #closureDialog
      class="dialog-panel"
      aria-labelledby="titre-fermeture"
      (close)="formProblem.set(null)"
    >
      <form
        class="flex flex-col gap-5 p-6"
        novalidate
        (submit)="$event.preventDefault(); saveClosure()"
      >
        <h2 id="titre-fermeture" class="text-lg font-semibold">Fermer une catégorie à la vente</h2>
        @if (formProblem(); as error) {
          @if (error.errors.length === 0) {
            <div class="alert-error" role="alert">
              <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
              <p>
                <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
              </p>
            </div>
          }
        }
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="fermeture-categorie">Catégorie</label>
          <select
            id="fermeture-categorie"
            class="field-control"
            [attr.aria-invalid]="error('categoryId') ? true : null"
            (change)="patchClosure({ categoryId: valueOf($event) })"
          >
            @for (category of categories(); track category.id) {
              <option [value]="category.id" [selected]="closure().categoryId === category.id">
                {{ category.name.fr }}
              </option>
            }
          </select>
          @if (error('categoryId'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="fermeture-debut">Première nuit</label>
            <input
              id="fermeture-debut"
              type="date"
              class="field-control"
              [attr.aria-invalid]="error('firstNight') ? true : null"
              [value]="closure().firstNight"
              (input)="patchClosure({ firstNight: valueOf($event) })"
            />
            @if (error('firstNight'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="fermeture-fin">Dernière nuit (incluse)</label>
            <input
              id="fermeture-fin"
              type="date"
              class="field-control"
              [attr.aria-invalid]="error('lastNight') ? true : null"
              [value]="closure().lastNight"
              (input)="patchClosure({ lastNight: valueOf($event) })"
            />
            @if (error('lastNight'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="fermeture-motif">Motif (facultatif)</label>
          <textarea
            id="fermeture-motif"
            class="field-control h-20 py-2"
            maxlength="300"
            [attr.aria-invalid]="error('reason') ? true : null"
            [value]="closure().reason"
            (input)="patchClosure({ reason: valueOf($event) })"
          ></textarea>
          @if (error('reason'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="flex flex-wrap justify-end gap-3">
          <button type="button" class="btn-quiet" (click)="closureDialog.close()">Retour</button>
          <button type="submit" class="btn-primary" [disabled]="saving()">Fermer à la vente</button>
        </div>
      </form>
    </dialog>

    <!-- Confirmation of a deletion -->
    <dialog #confirmDialog class="dialog-panel" aria-labelledby="titre-confirmation">
      @if (removal(); as pending) {
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-confirmation" class="text-lg font-semibold">{{ pending.title }}</h2>
          <p>{{ pending.text }}</p>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="confirmDialog.close()">Retour</button>
            <button
              type="button"
              class="btn-danger"
              [disabled]="saving()"
              (click)="confirmRemoval(pending)"
            >
              {{ pending.button }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class RatesPage {
  private readonly catalog = inject(CatalogApi);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);

  private readonly periodDialog = viewChild.required<ElementRef<HTMLDialogElement>>('periodDialog');
  private readonly closureDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('closureDialog');
  private readonly confirmDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected readonly categories = signal<Category[]>([]);
  protected readonly periods = signal<RatePeriod[]>([]);
  protected readonly closures = signal<SalesClosure[]>([]);
  protected readonly includePast = signal(false);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly canEdit = computed(() => canEditCatalog(this.session.user()?.role));
  protected readonly canClose = computed(() => canManageClosures(this.session.user()?.role));

  protected readonly editingPeriod = signal<RatePeriod | null>(null);
  protected readonly period = signal<PeriodDraft>(EMPTY_PERIOD);
  protected readonly closure = signal<ClosureDraft>({
    categoryId: '',
    firstNight: '',
    lastNight: '',
    reason: '',
  });
  protected readonly formProblem = signal<Problem | null>(null);
  protected readonly localErrors = signal<Record<string, string>>({});
  protected readonly removal = signal<Removal | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    try {
      const [categories, periods, closures] = await Promise.all([
        this.catalog.categories(),
        this.catalog.ratePeriods(this.includePast()),
        this.catalog.salesClosures(),
      ]);
      this.categories.set(categories);
      this.periods.set(periods);
      this.closures.set(closures);
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async togglePast(): Promise<void> {
    this.includePast.update((value) => !value);
    try {
      this.periods.set(await this.catalog.ratePeriods(this.includePast()));
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    }
  }

  // --- Display ---

  protected kindLabel(kind: RatePeriodKind): string {
    return RATE_PERIOD_KIND_LABELS[kind];
  }

  protected nights(firstNight: string, lastNight: string): string {
    const text = formatNights(firstNight, lastNight);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  protected percent(value: number): string {
    return formatPercent(value);
  }

  protected categoryName(id: string): string {
    return this.categories().find((category) => category.id === id)?.name.fr ?? 'Catégorie';
  }

  protected scopeOf(categoryId: string | null): string {
    return categoryId === null ? 'toutes les catégories' : this.categoryName(categoryId);
  }

  // --- Forms ---

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected error(field: string): string | undefined {
    return this.localErrors()[field] ?? fieldMessage(this.formProblem(), field);
  }

  protected kindOf(event: Event): void {
    this.patchPeriod({ kind: this.valueOf(event) === 'event' ? 'event' : 'season' });
  }

  protected patchPeriod(changes: Partial<PeriodDraft>): void {
    this.period.update((draft) => ({ ...draft, ...changes }));
  }

  protected patchClosure(changes: Partial<ClosureDraft>): void {
    this.closure.update((draft) => ({ ...draft, ...changes }));
  }

  private resetForm(): void {
    this.localErrors.set({});
    this.formProblem.set(null);
  }

  protected openPeriod(period: RatePeriod | null): void {
    this.editingPeriod.set(period);
    this.period.set(
      period === null
        ? EMPTY_PERIOD
        : {
            name: period.name,
            kind: period.kind,
            firstNight: period.firstNight,
            lastNight: period.lastNight,
            adjustment: percentInputValue(period.adjustmentPct),
            categoryId: period.categoryId ?? '',
          },
    );
    this.resetForm();
    this.periodDialog().nativeElement.showModal();
  }

  protected async savePeriod(): Promise<void> {
    const draft = this.period();
    const adjustmentPct = parsePercent(draft.adjustment);
    this.formProblem.set(null);
    if (adjustmentPct === null) {
      this.localErrors.set({ adjustmentPct: 'Pourcentage attendu, par exemple 20 ou -15.' });
      return;
    }
    this.localErrors.set({});
    const input = {
      name: draft.name.trim(),
      kind: draft.kind,
      firstNight: draft.firstNight,
      lastNight: draft.lastNight,
      adjustmentPct,
      categoryId: draft.categoryId === '' ? null : draft.categoryId,
    };
    const target = this.editingPeriod();
    this.saving.set(true);
    try {
      if (target === null) {
        await this.catalog.createRatePeriod(input);
        this.notifier.success(`La période « ${input.name} » est ajoutée.`);
      } else {
        await this.catalog.updateRatePeriod(target.id, input);
        this.notifier.success(`La période « ${input.name} » est modifiée.`);
      }
      this.periodDialog().nativeElement.close();
      await this.load();
    } catch (error) {
      this.formProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected openClosure(): void {
    this.closure.set({
      categoryId: this.categories()[0]?.id ?? '',
      firstNight: '',
      lastNight: '',
      reason: '',
    });
    this.resetForm();
    this.closureDialog().nativeElement.showModal();
  }

  protected async saveClosure(): Promise<void> {
    const draft = this.closure();
    const reason = draft.reason.trim();
    this.resetForm();
    this.saving.set(true);
    try {
      await this.catalog.createSalesClosure({
        categoryId: draft.categoryId,
        firstNight: draft.firstNight,
        lastNight: draft.lastNight,
        reason: reason === '' ? null : reason,
      });
      this.notifier.success(`« ${this.categoryName(draft.categoryId)} » est fermée à la vente.`);
      this.closureDialog().nativeElement.close();
      await this.load();
    } catch (error) {
      this.formProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  // --- Deletions, after confirmation ---

  protected askRemovePeriod(period: RatePeriod): void {
    this.removal.set({
      title: `Supprimer « ${period.name} » ?`,
      text:
        'Les prix reviennent au prix de base sur ces nuits pour les prochaines réservations. ' +
        'Les réservations déjà faites ne changent pas.',
      button: 'Supprimer la période',
      run: async () => {
        await this.catalog.deleteRatePeriod(period.id);
        this.notifier.success(`La période « ${period.name} » est supprimée.`);
      },
    });
    this.confirmDialog().nativeElement.showModal();
  }

  protected askRemoveClosure(closure: SalesClosure): void {
    const name = this.categoryName(closure.categoryId);
    const nights = formatNights(closure.firstNight, closure.lastNight);
    this.removal.set({
      title: `Rouvrir « ${name} » à la vente ?`,
      text: `La catégorie sera de nouveau vendue : ${nights}.`,
      button: 'Rouvrir à la vente',
      run: async () => {
        await this.catalog.deleteSalesClosure(closure.id);
        this.notifier.success(`« ${name} » est de nouveau en vente.`);
      },
    });
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmRemoval(pending: Removal): Promise<void> {
    this.saving.set(true);
    try {
      await pending.run();
      await this.load();
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.saving.set(false);
      this.confirmDialog().nativeElement.close();
    }
  }
}
