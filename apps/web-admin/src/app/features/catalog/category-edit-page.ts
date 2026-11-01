import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  type OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleAlert } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { NotifierService } from '../../core/notifier.service';
import { CatalogApi, type CategoryChanges } from './catalog-api';
import {
  AMENITY_CODES,
  AMENITY_LABELS,
  type AmenityCode,
  type Category,
  eurosInputValue,
  type LocalizedText,
  parseEuros,
  parseWhole,
} from './catalog-model';

type TextKey = 'name' | 'description' | 'beds';
type Language = keyof LocalizedText;
type NumberKey =
  | 'areaSqm'
  | 'maxOccupancy'
  | 'baseOccupancy'
  | 'basePriceCents'
  | 'extraAdultCents'
  | 'extraChildCents'
  | 'sortOrder';

interface Draft {
  texts: Record<TextKey, LocalizedText>;
  /** As typed: read (and checked) when saving. */
  numbers: Record<NumberKey, string>;
  amenities: AmenityCode[];
}

const TEXT_FIELDS: readonly { key: TextKey; label: string; multiline: boolean }[] = [
  { key: 'name', label: 'Nom', multiline: false },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'beds', label: 'Lits', multiline: false },
];

const LANGUAGES: readonly { code: Language; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'Anglais' },
];

const NUMBER_FIELDS: readonly { key: NumberKey; label: string; euros: boolean }[] = [
  { key: 'basePriceCents', label: 'Prix de base par nuit (€)', euros: true },
  { key: 'extraAdultCents', label: 'Supplément par adulte en plus (€)', euros: true },
  { key: 'extraChildCents', label: 'Supplément par enfant en plus (€)', euros: true },
  { key: 'maxOccupancy', label: 'Capacité maximale (personnes)', euros: false },
  { key: 'baseOccupancy', label: 'Personnes comprises dans le prix', euros: false },
  { key: 'areaSqm', label: 'Surface (m²)', euros: false },
  { key: 'sortOrder', label: 'Ordre d’affichage', euros: false },
];

function draftOf(category: Category): Draft {
  return {
    texts: {
      name: { ...category.name },
      description: { ...category.description },
      beds: { ...category.beds },
    },
    numbers: {
      areaSqm: String(category.areaSqm),
      maxOccupancy: String(category.maxOccupancy),
      baseOccupancy: String(category.baseOccupancy),
      basePriceCents: eurosInputValue(category.basePriceCents),
      extraAdultCents: eurosInputValue(category.extraAdultCents),
      extraChildCents: eurosInputValue(category.extraChildCents),
      sortOrder: String(category.sortOrder),
    },
    amenities: [...category.amenities],
  };
}

/**
 * One room category, management only (UI/UX specification, section 5.K): texts in French AND
 * English side by side, prices, capacity, equipment, display order. Deactivating asks for a
 * confirmation. The code never changes: it is part of the addresses of the public site.
 */
@Component({
  selector: 'adm-category-edit-page',
  imports: [RouterLink, LucideArrowLeft, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/catalogue/categories" class="mb-4 -ml-3 btn-quiet">
      <svg lucideArrowLeft></svg>
      Retour aux catégories
    </a>

    @if (loadProblem(); as error) {
      <div class="alert-error" role="alert">
        <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
        <p>
          <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
        </p>
      </div>
    } @else if (page(); as loaded) {
      @let current = loaded.category;
      @let form = loaded.draft;
      <form
        class="flex max-w-4xl flex-col gap-6"
        novalidate
        (submit)="$event.preventDefault(); save(current)"
      >
        <div class="card flex flex-col gap-1 p-5">
          <h2 class="text-xl font-semibold">{{ current.name.fr }}</h2>
          <p class="text-sm text-muted">Code {{ current.code }}, qui ne change jamais.</p>
          <p class="text-sm text-muted">
            Chambres actives : {{ current.activeRoomCount }} sur {{ current.roomCount }}.
          </p>
        </div>

        @if (saveProblem(); as error) {
          <div class="alert-error" role="alert">
            <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
            <p>
              <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
            </p>
          </div>
        }

        <section class="card flex flex-col gap-5 p-5" aria-labelledby="titre-textes">
          <h3 id="titre-textes" class="font-semibold">Textes du site</h3>
          @for (field of textFields; track field.key) {
            <fieldset class="flex flex-col gap-2">
              <legend class="field-label">{{ field.label }}</legend>
              <div class="grid gap-4 md:grid-cols-2">
                @for (language of languages; track language.code) {
                  @let path = field.key + '.' + language.code;
                  <div class="flex flex-col gap-1.5">
                    <label class="text-sm text-muted" [attr.for]="path">{{ language.label }}</label>
                    @if (field.multiline) {
                      <textarea
                        class="field-control h-28 py-2"
                        [id]="path"
                        [attr.aria-invalid]="error(path) ? true : null"
                        [value]="form.texts[field.key][language.code]"
                        (input)="setText(field.key, language.code, valueOf($event))"
                      ></textarea>
                    } @else {
                      <input
                        class="field-control"
                        [id]="path"
                        [attr.aria-invalid]="error(path) ? true : null"
                        [value]="form.texts[field.key][language.code]"
                        (input)="setText(field.key, language.code, valueOf($event))"
                      />
                    }
                    @if (error(path); as message) {
                      <p class="field-error">{{ message }}</p>
                    }
                  </div>
                }
              </div>
            </fieldset>
          }
        </section>

        <section class="card flex flex-col gap-5 p-5" aria-labelledby="titre-prix">
          <h3 id="titre-prix" class="font-semibold">Prix et capacité</h3>
          <p class="-mt-3 text-sm text-muted">
            Un nouveau prix ne s’applique qu’aux réservations faites après l’enregistrement.
          </p>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            @for (field of numberFields; track field.key) {
              <div class="flex flex-col gap-1.5">
                <label class="field-label" [attr.for]="field.key">{{ field.label }}</label>
                <input
                  class="field-control"
                  autocomplete="off"
                  [id]="field.key"
                  [attr.inputmode]="field.euros ? 'decimal' : 'numeric'"
                  [attr.aria-invalid]="error(field.key) ? true : null"
                  [value]="form.numbers[field.key]"
                  (input)="setNumber(field.key, valueOf($event))"
                />
                @if (error(field.key); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
            }
          </div>
        </section>

        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-equipements">
          <h3 id="titre-equipements" class="font-semibold">Équipements</h3>
          <div
            class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            role="group"
            aria-labelledby="titre-equipements"
          >
            @for (code of amenityCodes; track code) {
              <label class="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  class="size-5 accent-port"
                  [checked]="form.amenities.includes(code)"
                  (change)="toggleAmenity(code)"
                />
                {{ amenityLabel(code) }}
              </label>
            }
          </div>
        </section>

        <div class="flex flex-wrap justify-end gap-3">
          <a routerLink="/catalogue/categories" class="btn-quiet">Annuler</a>
          <button type="submit" class="btn-primary" [disabled]="saving()">
            {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
        </div>

        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-statut">
          <h3 id="titre-statut" class="font-semibold">Vente</h3>
          @if (current.isActive) {
            <p>Statut : <span class="badge-ok">active</span></p>
            <p class="text-sm text-muted">
              Elle est proposée sur le site si au moins une de ses chambres est active.
            </p>
            <button type="button" class="self-start btn-secondary" (click)="askToggle()">
              Désactiver la catégorie
            </button>
          } @else {
            <p>Statut : <span class="badge-off">désactivée</span></p>
            <p class="text-sm text-muted">Elle n’est plus proposée à la vente.</p>
            <button type="button" class="self-start btn-secondary" (click)="askToggle()">
              Réactiver la catégorie
            </button>
          }
        </section>
      </form>

      <dialog #confirmDialog class="dialog-panel" aria-labelledby="titre-confirmation">
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-confirmation" class="text-lg font-semibold">
            {{ current.isActive ? 'Désactiver' : 'Réactiver' }} « {{ current.name.fr }} » ?
          </h2>
          @if (current.isActive) {
            <p>
              La catégorie ne sera plus proposée sur le site. Les réservations déjà faites ne
              changent pas. Vous pourrez la réactiver.
            </p>
          } @else {
            <p>La catégorie sera de nouveau proposée à la vente.</p>
          }
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="confirmDialog.close()">Retour</button>
            <button
              type="button"
              [class]="current.isActive ? 'btn-danger' : 'btn-primary'"
              [disabled]="saving()"
              (click)="confirmToggle(current)"
            >
              {{ current.isActive ? 'Désactiver' : 'Réactiver' }}
            </button>
          </div>
        </div>
      </dialog>
    } @else {
      <p class="text-muted" role="status">Chargement de la catégorie…</p>
    }
  `,
})
export class CategoryEditPage implements OnInit {
  private readonly catalog = inject(CatalogApi);
  private readonly notifier = inject(NotifierService);
  private readonly router = inject(Router);
  private readonly confirmDialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');

  /** From the address /catalogue/categories/:id. */
  readonly id = input.required<string>();

  protected readonly textFields = TEXT_FIELDS;
  protected readonly languages = LANGUAGES;
  protected readonly numberFields = NUMBER_FIELDS;
  protected readonly amenityCodes = AMENITY_CODES;

  protected readonly category = signal<Category | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly loadProblem = signal<Problem | null>(null);
  protected readonly saveProblem = signal<Problem | null>(null);
  /** Mistakes found before sending (an amount that is not one…). */
  protected readonly localErrors = signal<Record<string, string>>({});
  protected readonly saving = signal(false);

  /** The category and its form, once loaded. */
  protected readonly page = computed(() => {
    const category = this.category();
    const draft = this.draft();
    return category === null || draft === null ? null : { category, draft };
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loadProblem.set(null);
    try {
      const found = (await this.catalog.categories()).find((item) => item.id === this.id());
      if (found === undefined) {
        this.loadProblem.set({
          status: 404,
          code: 'NOT_FOUND',
          title: 'Introuvable',
          detail: 'Cette catégorie n’existe pas.',
          errors: [],
        });
        return;
      }
      this.category.set(found);
      this.draft.set(draftOf(found));
    } catch (error) {
      this.loadProblem.set(toProblem(error));
    }
  }

  protected amenityLabel(code: AmenityCode): string {
    return AMENITY_LABELS[code];
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected error(field: string): string | undefined {
    return this.localErrors()[field] ?? fieldMessage(this.saveProblem(), field);
  }

  protected setText(key: TextKey, language: Language, value: string): void {
    this.draft.update((draft) => {
      if (draft === null) {
        return draft;
      }
      const text = { ...draft.texts[key], [language]: value };
      return { ...draft, texts: { ...draft.texts, [key]: text } };
    });
  }

  protected setNumber(key: NumberKey, value: string): void {
    this.draft.update((draft) => {
      return draft === null ? draft : { ...draft, numbers: { ...draft.numbers, [key]: value } };
    });
  }

  protected toggleAmenity(code: AmenityCode): void {
    this.draft.update((draft) => {
      if (draft === null) {
        return draft;
      }
      const amenities = draft.amenities.includes(code)
        ? draft.amenities.filter((item) => item !== code)
        : AMENITY_CODES.filter((item) => item === code || draft.amenities.includes(item));
      return { ...draft, amenities };
    });
  }

  /** Reads the typed numbers; notes a message for each one that cannot be read. */
  private changesOf(draft: Draft): CategoryChanges | null {
    const errors: Record<string, string> = {};
    const numbers: Partial<Record<NumberKey, number>> = {};
    for (const field of NUMBER_FIELDS) {
      const text = draft.numbers[field.key];
      const value = field.euros ? parseEuros(text) : parseWhole(text);
      if (value === null) {
        errors[field.key] = field.euros
          ? 'Montant attendu, par exemple 95 ou 95,50.'
          : 'Nombre entier attendu.';
      } else {
        numbers[field.key] = value;
      }
    }
    this.localErrors.set(errors);
    if (Object.keys(errors).length > 0) {
      return null;
    }
    return {
      name: draft.texts.name,
      description: draft.texts.description,
      beds: draft.texts.beds,
      amenities: draft.amenities,
      ...numbers,
    };
  }

  protected async save(current: Category): Promise<void> {
    const draft = this.draft();
    if (draft === null) {
      return;
    }
    this.saveProblem.set(null);
    const changes = this.changesOf(draft);
    if (changes === null) {
      return;
    }
    this.saving.set(true);
    try {
      await this.catalog.updateCategory(current.id, changes);
      this.notifier.success(`La catégorie « ${draft.texts.name.fr.trim()} » est enregistrée.`);
      await this.router.navigate(['/catalogue/categories']);
    } catch (error) {
      this.saveProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected askToggle(): void {
    this.confirmDialog()?.nativeElement.showModal();
  }

  protected async confirmToggle(current: Category): Promise<void> {
    this.saving.set(true);
    try {
      const updated = await this.catalog.updateCategory(current.id, {
        isActive: !current.isActive,
      });
      this.category.set(updated);
      this.notifier.success(
        updated.isActive
          ? `La catégorie « ${updated.name.fr} » est réactivée.`
          : `La catégorie « ${updated.name.fr} » est désactivée.`,
      );
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.saving.set(false);
      this.confirmDialog()?.nativeElement.close();
    }
  }
}
