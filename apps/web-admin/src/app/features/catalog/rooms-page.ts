import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideCircleAlert, LucidePencil, LucidePlus } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { CatalogApi } from './catalog-api';
import {
  canEditCatalog,
  type Category,
  HOUSEKEEPING_LABELS,
  type HousekeepingStatus,
  parseWhole,
  type Room,
} from './catalog-model';

type StateFilter = 'all' | 'active' | 'inactive';

interface Draft {
  number: string;
  floor: string;
  categoryId: string;
}

/**
 * Rooms of the hotel (UI/UX specification, section 5.K): a table filtered by category, floor
 * and state. The management adds a room, changes its number, floor or category, and
 * deactivates it after confirmation (a room is never deleted: reservations refer to it).
 */
@Component({
  selector: 'adm-rooms-page',
  imports: [LucidePlus, LucidePencil, LucideCircleAlert],
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
      <p class="text-muted" role="status">Chargement des chambres…</p>
    } @else {
      <div class="mb-4 flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="filtre-categorie">Catégorie</label>
          <select
            id="filtre-categorie"
            class="field-control w-56"
            (change)="categoryFilter.set(valueOf($event))"
          >
            <option value="" [selected]="categoryFilter() === ''">Toutes</option>
            @for (category of categories(); track category.id) {
              <option [value]="category.id" [selected]="categoryFilter() === category.id">
                {{ category.name.fr }}
              </option>
            }
          </select>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="filtre-etage">Étage</label>
          <select id="filtre-etage" class="field-control w-32" (change)="floorOf($event)">
            <option value="" [selected]="floorFilter() === null">Tous</option>
            @for (floor of floors(); track floor) {
              <option [value]="floor" [selected]="floorFilter() === floor">{{ floor }}</option>
            }
          </select>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="filtre-etat">État</label>
          <select id="filtre-etat" class="field-control w-40" (change)="stateOf($event)">
            <option value="all" [selected]="stateFilter() === 'all'">Toutes</option>
            <option value="active" [selected]="stateFilter() === 'active'">Actives</option>
            <option value="inactive" [selected]="stateFilter() === 'inactive'">Désactivées</option>
          </select>
        </div>
        @if (canEdit()) {
          <button type="button" class="ml-auto btn-primary" (click)="openCreate()">
            <svg lucidePlus></svg>
            Ajouter une chambre
          </button>
        }
      </div>

      <p class="mb-2 text-sm text-muted" role="status">
        {{ shown().length }} chambre(s) affichée(s) sur {{ rooms().length }}.
      </p>
      <div class="card overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">
            Chambres de l’hôtel
          </caption>
          <thead class="border-b border-line text-muted">
            <tr>
              <th scope="col" class="px-4 py-3 font-semibold">Numéro</th>
              <th scope="col" class="px-4 py-3 font-semibold">Étage</th>
              <th scope="col" class="px-4 py-3 font-semibold">Catégorie</th>
              <th scope="col" class="px-4 py-3 font-semibold">Ménage</th>
              <th scope="col" class="px-4 py-3 font-semibold">État</th>
              @if (canEdit()) {
                <th scope="col" class="px-4 py-3 font-semibold">
                  <span class="sr-only">Actions</span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (room of shown(); track room.id) {
              <tr class="border-b border-line last:border-0">
                <th scope="row" class="px-4 py-3 font-semibold">{{ room.number }}</th>
                <td class="px-4 py-3">{{ room.floor }}</td>
                <td class="px-4 py-3">{{ room.categoryName }}</td>
                <td class="px-4 py-3">{{ housekeepingLabel(room.housekeepingStatus) }}</td>
                <td class="px-4 py-3">
                  @if (room.isActive) {
                    <span class="badge-ok">Active</span>
                  } @else {
                    <span class="badge-off">Désactivée</span>
                  }
                </td>
                @if (canEdit()) {
                  <td class="px-4 py-2 text-right whitespace-nowrap">
                    <button type="button" class="btn-quiet" (click)="openEdit(room)">
                      <svg lucidePencil></svg>
                      Modifier
                      <span class="sr-only">la chambre {{ room.number }}</span>
                    </button>
                    <button type="button" class="btn-quiet" (click)="askToggle(room)">
                      {{ room.isActive ? 'Désactiver' : 'Réactiver' }}
                      <span class="sr-only">la chambre {{ room.number }}</span>
                    </button>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="px-4 py-6 text-center text-muted">
                  Aucune chambre ne correspond à ces filtres.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Add or edit -->
    <dialog
      #formDialog
      class="dialog-panel"
      aria-labelledby="titre-chambre"
      (close)="formProblem.set(null)"
    >
      <form class="flex flex-col gap-5 p-6" novalidate (submit)="$event.preventDefault(); save()">
        <h2 id="titre-chambre" class="text-lg font-semibold">
          {{ editing() === null ? 'Ajouter une chambre' : 'Modifier la chambre' }}
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
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="numero">Numéro</label>
            <input
              id="numero"
              class="field-control"
              autocomplete="off"
              [attr.aria-invalid]="error('number') ? true : null"
              [value]="draft().number"
              (input)="patch({ number: valueOf($event) })"
            />
            @if (error('number'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="etage">Étage</label>
            <input
              id="etage"
              class="field-control"
              inputmode="numeric"
              autocomplete="off"
              [attr.aria-invalid]="error('floor') ? true : null"
              [value]="draft().floor"
              (input)="patch({ floor: valueOf($event) })"
            />
            @if (error('floor'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="categorie">Catégorie</label>
          <select
            id="categorie"
            class="field-control"
            [attr.aria-invalid]="error('categoryId') ? true : null"
            (change)="patch({ categoryId: valueOf($event) })"
          >
            @for (category of categories(); track category.id) {
              <option [value]="category.id" [selected]="draft().categoryId === category.id">
                {{ category.name.fr }}{{ category.isActive ? '' : ' (désactivée)' }}
              </option>
            }
          </select>
          @if (error('categoryId'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="flex flex-wrap justify-end gap-3">
          <button type="button" class="btn-quiet" (click)="formDialog.close()">Retour</button>
          <button type="submit" class="btn-primary" [disabled]="saving()">
            {{ editing() === null ? 'Ajouter' : 'Enregistrer' }}
          </button>
        </div>
      </form>
    </dialog>

    <!-- Confirmation: deactivate or reactivate -->
    <dialog #confirmDialog class="dialog-panel" aria-labelledby="titre-confirmation">
      @if (toggling(); as room) {
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-confirmation" class="text-lg font-semibold">
            {{ room.isActive ? 'Désactiver' : 'Réactiver' }} la chambre {{ room.number }} ?
          </h2>
          @if (room.isActive) {
            <p>
              Elle ne sera plus proposée à la vente ni attribuée. Son historique est conservé : vous
              pourrez la réactiver.
            </p>
          } @else {
            <p>Elle sera de nouveau proposée à la vente.</p>
          }
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="confirmDialog.close()">Retour</button>
            <button
              type="button"
              [class]="room.isActive ? 'btn-danger' : 'btn-primary'"
              [disabled]="saving()"
              (click)="confirmToggle(room)"
            >
              {{ room.isActive ? 'Désactiver' : 'Réactiver' }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class RoomsPage {
  private readonly catalog = inject(CatalogApi);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);

  private readonly formDialog = viewChild.required<ElementRef<HTMLDialogElement>>('formDialog');
  private readonly confirmDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected readonly rooms = signal<Room[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);
  protected readonly canEdit = computed(() => canEditCatalog(this.session.user()?.role));

  protected readonly categoryFilter = signal('');
  protected readonly floorFilter = signal<number | null>(null);
  protected readonly stateFilter = signal<StateFilter>('all');

  protected readonly floors = computed(() => {
    const floors = new Set(this.rooms().map((room) => room.floor));
    return [...floors].sort((a, b) => a - b);
  });

  protected readonly shown = computed(() => {
    const category = this.categoryFilter();
    const floor = this.floorFilter();
    const state = this.stateFilter();
    return this.rooms().filter((room) => {
      const inCategory = category === '' || room.categoryId === category;
      const onFloor = floor === null || room.floor === floor;
      const inState = state === 'all' || room.isActive === (state === 'active');
      return inCategory && onFloor && inState;
    });
  });

  protected readonly editing = signal<Room | null>(null);
  protected readonly draft = signal<Draft>({ number: '', floor: '', categoryId: '' });
  protected readonly formProblem = signal<Problem | null>(null);
  protected readonly localErrors = signal<Record<string, string>>({});
  protected readonly toggling = signal<Room | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    try {
      const [rooms, categories] = await Promise.all([
        this.catalog.rooms(),
        this.catalog.categories(),
      ]);
      this.rooms.set(rooms);
      this.categories.set(categories);
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected housekeepingLabel(status: HousekeepingStatus): string {
    return HOUSEKEEPING_LABELS[status];
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected floorOf(event: Event): void {
    const value = this.valueOf(event);
    this.floorFilter.set(value === '' ? null : Number(value));
  }

  protected stateOf(event: Event): void {
    const value = this.valueOf(event);
    this.stateFilter.set(value === 'active' || value === 'inactive' ? value : 'all');
  }

  protected error(field: string): string | undefined {
    return this.localErrors()[field] ?? fieldMessage(this.formProblem(), field);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.draft.set({
      number: '',
      floor: '',
      categoryId: this.categoryFilter() || (this.categories()[0]?.id ?? ''),
    });
    this.localErrors.set({});
    this.formProblem.set(null);
    this.formDialog().nativeElement.showModal();
  }

  protected openEdit(room: Room): void {
    this.editing.set(room);
    this.draft.set({ number: room.number, floor: String(room.floor), categoryId: room.categoryId });
    this.localErrors.set({});
    this.formProblem.set(null);
    this.formDialog().nativeElement.showModal();
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    const floor = parseWhole(draft.floor);
    this.localErrors.set(floor === null ? { floor: 'Nombre entier attendu, par exemple 2.' } : {});
    this.formProblem.set(null);
    if (floor === null) {
      return;
    }
    const input = { number: draft.number.trim(), floor, categoryId: draft.categoryId };
    const target = this.editing();
    this.saving.set(true);
    try {
      if (target === null) {
        await this.catalog.createRoom(input);
        this.notifier.success(`La chambre ${input.number} est ajoutée.`);
      } else {
        await this.catalog.updateRoom(target.id, input);
        this.notifier.success(`La chambre ${input.number} est modifiée.`);
      }
      this.formDialog().nativeElement.close();
      await this.load();
    } catch (error) {
      this.formProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected askToggle(room: Room): void {
    this.toggling.set(room);
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmToggle(room: Room): Promise<void> {
    this.saving.set(true);
    try {
      await this.catalog.updateRoom(room.id, { isActive: !room.isActive });
      this.notifier.success(
        room.isActive
          ? `La chambre ${room.number} est désactivée.`
          : `La chambre ${room.number} est réactivée.`,
      );
      await this.load();
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.saving.set(false);
      this.confirmDialog().nativeElement.close();
    }
  }
}
