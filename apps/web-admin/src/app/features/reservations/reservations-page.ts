import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleAlert,
  LucidePlus,
  LucideSearch,
} from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { ReservationApi, type ReservationFilter } from './reservation-api';
import {
  type Badge,
  customerName,
  formatDay,
  formatEuros,
  paymentBadgesOf,
  type ReservationPage,
  type ReservationStatus,
  type ReservationSummary,
  roomText,
  type SortOrder,
  type Source,
  SOURCE_LABELS,
  STATUS_LABELS,
  statusBadge,
} from './reservation-model';

const STATUSES: readonly ReservationStatus[] = [
  'pending_payment',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show',
];

const SOURCES: readonly Source[] = ['website', 'phone', 'desk'];

const SORTS: readonly { value: SortOrder; label: string }[] = [
  { value: 'checkIn', label: 'Arrivée' },
  { value: 'created', label: 'Création (récentes d’abord)' },
  { value: 'total', label: 'Total (plus élevé d’abord)' },
];

const EMPTY_FILTER: ReservationFilter = { sort: 'checkIn', page: 1 };

/**
 * Reservations (UI/UX specification, section 5.D): search by reference, name or e-mail, filters
 * and sort, 25 per page; by default the arrivals from today. A table on a computer, cards on a
 * phone. A tap on a reservation opens its page.
 */
@Component({
  selector: 'adm-reservations-page',
  imports: [
    RouterLink,
    LucidePlus,
    LucideSearch,
    LucideCircleAlert,
    LucideChevronLeft,
    LucideChevronRight,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <a routerLink="/reservations/nouvelle" class="self-end btn-primary">
        <svg lucidePlus></svg>
        Nouvelle réservation
      </a>
      <form
        class="card flex flex-col gap-3 p-4"
        role="search"
        novalidate
        (submit)="$event.preventDefault(); search()"
      >
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-60 flex-1 flex-col gap-1.5">
            <label class="field-label" for="recherche">Référence, nom ou e-mail</label>
            <input
              id="recherche"
              type="search"
              class="field-control"
              autocomplete="off"
              [value]="query()"
              (input)="query.set(valueOf($event))"
            />
          </div>
          <button type="submit" class="btn-primary">
            <svg lucideSearch></svg>
            Rechercher
          </button>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="filtre-statut">Statut</label>
            <select id="filtre-statut" class="field-control w-44" (change)="statusOf($event)">
              <option value="" [selected]="filter().status === undefined">Tous</option>
              @for (value of statuses; track value) {
                <option [value]="value" [selected]="filter().status === value">
                  {{ statusLabel(value) }}
                </option>
              }
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="filtre-origine">Origine</label>
            <select id="filtre-origine" class="field-control w-36" (change)="sourceOf($event)">
              <option value="" [selected]="filter().source === undefined">Toutes</option>
              @for (value of sources; track value) {
                <option [value]="value" [selected]="filter().source === value">
                  {{ sourceLabel(value) }}
                </option>
              }
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="filtre-du">Arrivée du</label>
            <input
              id="filtre-du"
              type="date"
              class="field-control w-40"
              [value]="filter().arrivalFrom ?? ''"
              (change)="patch({ arrivalFrom: valueOf($event) || undefined })"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="filtre-au">au</label>
            <input
              id="filtre-au"
              type="date"
              class="field-control w-40"
              [value]="filter().arrivalTo ?? ''"
              (change)="patch({ arrivalTo: valueOf($event) || undefined })"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="filtre-tri">Trier par</label>
            <select id="filtre-tri" class="field-control w-56" (change)="sortOf($event)">
              @for (option of sorts; track option.value) {
                <option [value]="option.value" [selected]="filter().sort === option.value">
                  {{ option.label }}
                </option>
              }
            </select>
          </div>
          <label class="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              class="size-5 accent-port"
              [checked]="filter().unassigned === true"
              (change)="patch({ unassigned: !filter().unassigned })"
            />
            Sans chambre attribuée
          </label>
        </div>
      </form>

      <div class="flex flex-wrap items-center gap-3">
        <p class="mr-auto text-lg font-semibold" role="status">{{ countText() }}</p>
        @if (filtered()) {
          <button type="button" class="btn-quiet" (click)="clear()">Effacer les filtres</button>
        }
      </div>

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
      } @else if (page(); as current) {
        @if (current.items.length === 0) {
          <div class="card flex flex-col items-center gap-2 p-6 text-center text-muted">
            <p>Aucune réservation ne correspond à ces filtres.</p>
            @if (filtered()) {
              <button type="button" class="btn-quiet" (click)="clear()">Effacer les filtres</button>
            }
          </div>
        } @else {
          <div class="card hidden overflow-x-auto md:block">
            <table class="w-full text-left text-sm">
              <caption class="sr-only">
                Réservations
              </caption>
              <thead class="border-b border-line text-muted">
                <tr>
                  <th scope="col" class="px-4 py-3 font-semibold">Référence</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Client</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Arrivée</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Départ</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Nuits</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Chambres</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Paiement</th>
                  <th scope="col" class="px-4 py-3 text-right font-semibold">Total</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Origine</th>
                </tr>
              </thead>
              <tbody>
                @for (item of current.items; track item.id) {
                  <tr class="border-b border-line last:border-0 hover:bg-mist">
                    <th scope="row" class="px-4 py-3 font-semibold">
                      <a class="text-port hover:underline" [routerLink]="item.id">
                        {{ item.reference }}
                      </a>
                    </th>
                    <td class="px-4 py-3">{{ name(item) }}</td>
                    <td class="px-4 py-3 whitespace-nowrap">{{ day(item.checkIn) }}</td>
                    <td class="px-4 py-3 whitespace-nowrap">{{ day(item.checkOut) }}</td>
                    <td class="px-4 py-3">{{ item.nights }}</td>
                    <td class="px-4 py-3">
                      @for (room of item.rooms; track $index) {
                        <span class="block">{{ roomLabel(room) }}</span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <span [class]="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
                    </td>
                    <td class="px-4 py-3">
                      <span class="flex flex-col items-start gap-1">
                        @for (badge of paymentBadges(item); track badge.label) {
                          <span [class]="badge.className">{{ badge.label }}</span>
                        }
                      </span>
                    </td>
                    <td class="px-4 py-3 text-right whitespace-nowrap">
                      {{ euros(item.totalCents) }}
                    </td>
                    <td class="px-4 py-3">{{ sourceLabel(item.source) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <ul class="flex flex-col gap-3 md:hidden" aria-label="Réservations">
            @for (item of current.items; track item.id) {
              <li>
                <a class="card flex flex-col gap-1 p-4 hover:border-port" [routerLink]="item.id">
                  <span class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="font-semibold">{{ item.reference }}</span>
                    <span [class]="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
                    @for (badge of paymentBadges(item); track badge.label) {
                      <span [class]="badge.className">{{ badge.label }}</span>
                    }
                  </span>
                  <span class="font-semibold">{{ name(item) }}</span>
                  <span class="text-sm text-muted">{{ cardLine(item) }}</span>
                  @for (room of item.rooms; track $index) {
                    <span class="text-sm">{{ roomLabel(room) }}</span>
                  }
                </a>
              </li>
            }
          </ul>

          @if (pageCount() > 1) {
            <nav class="flex items-center justify-center gap-3" aria-label="Pages">
              <button
                type="button"
                class="btn-quiet"
                [disabled]="current.page <= 1 || loading()"
                (click)="goTo(current.page - 1)"
              >
                <svg lucideChevronLeft></svg>
                Précédente
              </button>
              <span class="text-sm">Page {{ current.page }} sur {{ pageCount() }}</span>
              <button
                type="button"
                class="btn-quiet"
                [disabled]="current.page >= pageCount() || loading()"
                (click)="goTo(current.page + 1)"
              >
                Suivante
                <svg lucideChevronRight></svg>
              </button>
            </nav>
          }
        }
      } @else {
        <p class="text-muted" role="status">Chargement des réservations…</p>
      }
    </div>
  `,
})
export class ReservationsPage {
  private readonly api = inject(ReservationApi);

  protected readonly statuses = STATUSES;
  protected readonly sources = SOURCES;
  protected readonly sorts = SORTS;

  protected readonly query = signal('');
  protected readonly filter = signal<ReservationFilter>(EMPTY_FILTER);
  protected readonly page = signal<ReservationPage | null>(null);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly pageCount = computed(() => {
    const current = this.page();
    return current === null ? 0 : Math.ceil(current.total / current.pageSize);
  });

  protected readonly countText = computed(() => {
    const total = this.page()?.total ?? 0;
    return total === 1 ? '1 réservation' : `${total} réservations`;
  });

  /** Something else than the default view (arrivals from today, by arrival). */
  protected readonly filtered = computed(() => {
    const filter = this.filter();
    return (
      filter.q !== undefined ||
      filter.status !== undefined ||
      filter.source !== undefined ||
      filter.arrivalFrom !== undefined ||
      filter.arrivalTo !== undefined ||
      filter.unassigned === true
    );
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    try {
      this.page.set(await this.api.list(this.filter()));
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Any change of filter goes back to the first page. */
  protected patch(changes: Partial<ReservationFilter>): void {
    this.filter.update((filter) => ({ ...filter, ...changes, page: 1 }));
    void this.load();
  }

  protected search(): void {
    const text = this.query().trim();
    this.patch({ q: text === '' ? undefined : text });
  }

  protected clear(): void {
    this.query.set('');
    this.filter.set(EMPTY_FILTER);
    void this.load();
  }

  protected goTo(page: number): void {
    this.filter.update((filter) => ({ ...filter, page }));
    void this.load();
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected statusOf(event: Event): void {
    const value = this.valueOf(event);
    this.patch({ status: STATUSES.find((status) => status === value) });
  }

  protected sourceOf(event: Event): void {
    const value = this.valueOf(event);
    this.patch({ source: SOURCES.find((source) => source === value) });
  }

  protected sortOf(event: Event): void {
    const value = this.valueOf(event);
    this.patch({ sort: SORTS.find((option) => option.value === value)?.value ?? 'checkIn' });
  }

  protected name(item: ReservationSummary): string {
    return customerName(item.customer);
  }

  protected day(date: string): string {
    return formatDay(date);
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }

  /** « 10 mai 2034 → 12 mai 2034 · 230,00 € » on the cards of the phone. */
  protected cardLine(item: ReservationSummary): string {
    const dates = `${formatDay(item.checkIn)} → ${formatDay(item.checkOut)}`;
    return `${dates} · ${formatEuros(item.totalCents)}`;
  }

  protected roomLabel(room: ReservationSummary['rooms'][number]): string {
    return roomText(room);
  }

  protected statusLabel(status: ReservationStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusClass(status: ReservationStatus): string {
    return statusBadge(status);
  }

  protected paymentBadges(item: ReservationSummary): Badge[] {
    return paymentBadgesOf(item);
  }

  protected sourceLabel(source: Source): string {
    return SOURCE_LABELS[source];
  }
}
