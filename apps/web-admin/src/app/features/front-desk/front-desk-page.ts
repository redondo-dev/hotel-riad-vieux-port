import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert, LucideX } from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { NotifierService } from '../../core/notifier.service';
import { headcountText, hotelToday } from '../planning/planning-model';
import {
  formatDay,
  formatEuros,
  STATUS_LABELS,
  statusBadge,
} from '../reservations/reservation-model';
import { type CheckInChecks, FrontDeskApi } from './front-desk-api';
import {
  ACTION_LABELS,
  actionsFor,
  countText,
  dirtyText,
  type FrontDeskAction,
  type FrontDeskDay,
  type FrontDeskItem,
  noShowFeeText,
  roomCheck,
  roomLineText,
} from './front-desk-model';

type Tab = 'arrivals' | 'departures';

/** The stay in the side panel, and what it is opened for. */
interface Opened {
  item: FrontDeskItem;
  action: FrontDeskAction;
}

/**
 * « Today », the work screen of the reception (UI/UX specification, section 5.H): the arrivals
 * and departures of a day with their counters, and the side panel that records an arrival, a
 * departure or a no-show. The actions are offered on today only; another day is read only.
 * `?ouvrir=<id>` (from a reservation page) opens the panel of that stay.
 */
@Component({
  selector: 'adm-front-desk-page',
  imports: [RouterLink, LucideCircleAlert, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="card flex flex-wrap items-end gap-3 p-4">
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="jour">Jour</label>
          <input
            id="jour"
            type="date"
            class="field-control"
            [value]="date()"
            (change)="showDay(valueOf($event))"
          />
        </div>
        @if (date() !== today()) {
          <button type="button" class="btn-secondary" (click)="showDay(today())">
            Aujourd’hui
          </button>
        }
        <p class="ml-auto self-center text-sm text-muted first-letter:uppercase">{{ dayText() }}</p>
      </div>

      <div class="flex gap-2" role="tablist" aria-label="Arrivées et départs">
        <button
          type="button"
          role="tab"
          class="flex-1 rounded-lg border px-4 py-3 text-left sm:flex-none"
          [class]="tab() === 'arrivals' ? activeTab : idleTab"
          [attr.aria-selected]="tab() === 'arrivals'"
          (click)="tab.set('arrivals')"
        >
          <span class="block font-semibold">Arrivées</span>
          <span class="block text-sm">{{ arrivalsCount() }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="flex-1 rounded-lg border px-4 py-3 text-left sm:flex-none"
          [class]="tab() === 'departures' ? activeTab : idleTab"
          [attr.aria-selected]="tab() === 'departures'"
          (click)="tab.set('departures')"
        >
          <span class="block font-semibold">Départs</span>
          <span class="block text-sm">{{ departuresCount() }}</span>
        </button>
      </div>

      @if (problem(); as error) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <div class="flex flex-col items-start gap-2">
            <p>
              <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
            </p>
            <button type="button" class="btn-secondary" (click)="load()">Réessayer</button>
          </div>
        </div>
      } @else if (day() === null) {
        <p class="text-muted" role="status">Chargement…</p>
      } @else {
        <ul class="flex flex-col gap-3" role="tabpanel" [attr.aria-label]="tabLabel()">
          @for (item of items(); track item.id) {
            <li class="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <p class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold">{{ item.customerName }}</span>
                  <a
                    class="text-sm text-port hover:underline"
                    [routerLink]="['/reservations', item.id]"
                  >
                    {{ item.reference }}
                  </a>
                  <span [class]="badge(item)">{{ statusLabel(item) }}</span>
                  @if (item.late) {
                    <span class="badge-warning">{{ lateText(item) }}</span>
                  }
                </p>
                <p class="text-sm">{{ headcount(item) }} · {{ nightsText(item) }}</p>
                <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  @for (line of item.rooms; track line.lineId) {
                    <li class="flex items-center gap-2">
                      {{ roomText(line) }}
                      @if (line.room === null) {
                        <span class="badge-warning">À attribuer</span>
                      } @else if (line.room.outOfService) {
                        <span class="badge-off">Hors service</span>
                      } @else if (line.room.housekeepingStatus === 'dirty') {
                        <span class="badge-warning">À nettoyer</span>
                      }
                    </li>
                  }
                </ul>
                @if (item.customerMessage; as message) {
                  <p class="text-sm text-muted">« {{ message }} »</p>
                }
              </div>
              <p class="text-sm sm:text-right">
                <span class="block text-muted">{{ amountLabel() }}</span>
                <span class="font-semibold">{{ euros(item.totalCents) }}</span>
              </p>
              @if (onToday()) {
                <div class="flex flex-wrap gap-2 sm:flex-col">
                  @for (action of actions(item); track action) {
                    <button
                      type="button"
                      [class]="action === 'no-show' ? 'btn-quiet' : 'btn-primary'"
                      (click)="open(item, action)"
                    >
                      {{ actionLabel(action) }}
                    </button>
                  }
                </div>
              }
            </li>
          } @empty {
            <li class="card p-5 text-muted">{{ emptyText() }}</li>
          }
        </ul>
      }
    </div>

    <dialog #panel class="side-panel" aria-labelledby="titre-action" (close)="opened.set(null)">
      @if (opened(); as current) {
        <div class="flex items-start gap-3 border-b border-line p-5">
          <h2 id="titre-action" class="flex-1 text-lg font-semibold">
            {{ actionLabel(current.action) }}
          </h2>
          <button type="button" class="-m-2 btn-icon" aria-label="Fermer" (click)="close()">
            <svg lucideX></svg>
          </button>
        </div>
        <div class="flex flex-col gap-5 p-5">
          <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted">Client</dt>
            <dd>{{ current.item.customerName }} · {{ current.item.reference }}</dd>
            <dt class="text-muted">Séjour</dt>
            <dd>{{ stayText(current.item) }}</dd>
            <dt class="text-muted">Voyageurs</dt>
            <dd>{{ headcount(current.item) }}</dd>
            <dt class="text-muted">Chambres</dt>
            <dd>
              @for (line of current.item.rooms; track line.lineId) {
                <span class="block">{{ roomText(line) }}</span>
              }
            </dd>
            <dt class="text-muted">{{ current.action === 'check-out' ? 'Reste dû' : 'Total' }}</dt>
            <dd class="font-semibold">{{ euros(current.item.totalCents) }}</dd>
          </dl>

          @switch (current.action) {
            @case ('check-in') {
              @if (check().missing > 0) {
                <div class="alert-error" role="alert">
                  <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                  <p>Attribuez une chambre à chaque ligne de la réservation avant l’arrivée.</p>
                </div>
              } @else if (check().outOfService.length > 0) {
                <div class="alert-error" role="alert">
                  <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                  <p>
                    Chambre {{ check().outOfService.join(', ') }} hors service : changez de chambre.
                  </p>
                </div>
              } @else if (check().dirty.length > 0) {
                <div class="alert-info" role="alert">
                  <svg lucideCircleAlert class="mt-0.5 shrink-0 text-warning"></svg>
                  <p>
                    {{ dirtyWarning() }}. Choisissez une autre chambre, ou enregistrez quand même.
                  </p>
                </div>
              }
              <fieldset class="flex flex-col gap-1">
                <legend class="mb-2 text-sm font-semibold">Vérifications</legend>
                <label class="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    class="size-5 accent-port"
                    [checked]="identityChecked()"
                    (change)="identityChecked.set(!identityChecked())"
                  />
                  Identité vérifiée
                </label>
                <label class="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    class="size-5 accent-port"
                    [checked]="policeFormDone()"
                    (change)="policeFormDone.set(!policeFormDone())"
                  />
                  Fiche de police remplie (client étranger)
                </label>
              </fieldset>
            }
            @case ('check-out') {
              <p class="alert-info" role="note">
                L’encaissement du solde et la facture viendront avec la facturation. Les chambres
                passeront « à nettoyer ».
              </p>
            }
            @case ('no-show') {
              <p class="alert-info" role="note">
                {{ feeText(current.item) }} Les frais sont enregistrés à encaisser et les chambres
                libérées.
              </p>
            }
          }

          @if (actionProblem(); as error) {
            <div class="alert-error" role="alert">
              <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
              <p>
                <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
              </p>
            </div>
          }

          <div class="flex flex-wrap justify-end gap-2">
            @if (current.action === 'check-in' && needsRoom()) {
              <a class="btn-secondary" [routerLink]="['/reservations', current.item.id]">
                {{ check().dirty.length > 0 ? 'Choisir une autre chambre' : 'Ouvrir la fiche' }}
              </a>
            }
            <button
              type="button"
              [class]="current.action === 'no-show' ? 'btn-danger' : 'btn-primary'"
              [disabled]="saving() || blocked()"
              (click)="confirm(current)"
            >
              {{ confirmLabel() }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class FrontDeskPage {
  private readonly api = inject(FrontDeskApi);
  private readonly notifier = inject(NotifierService);
  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  /** From the address: `?ouvrir=<reservation id>` opens its panel once the day is loaded. */
  readonly ouvrir = input<string | undefined>(undefined);

  protected readonly activeTab = 'border-port bg-port text-white';
  protected readonly idleTab = 'border-line bg-white text-ink';

  protected readonly today = signal(hotelToday(new Date()));
  protected readonly date = signal(this.today());
  protected readonly tab = signal<Tab>('arrivals');
  protected readonly day = signal<FrontDeskDay | null>(null);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly opened = signal<Opened | null>(null);
  protected readonly identityChecked = signal(false);
  protected readonly policeFormDone = signal(false);
  protected readonly saving = signal(false);
  protected readonly actionProblem = signal<Problem | null>(null);

  /** Answers of a day left meanwhile are dropped. */
  private request = 0;
  /** `?ouvrir` is used once. */
  private pendingOpen = true;

  protected readonly onToday = computed(() => this.date() === this.today());
  protected readonly dayText = computed(() => {
    return new Date(`${this.date()}T00:00:00Z`).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  });
  protected readonly arrivalsCount = computed(() => {
    const current = this.day();
    return current === null ? '…' : countText(current.arrivals);
  });
  protected readonly departuresCount = computed(() => {
    const current = this.day();
    return current === null ? '…' : countText(current.departures);
  });
  protected readonly items = computed(() => {
    const current = this.day();
    if (current === null) {
      return [];
    }
    return this.tab() === 'arrivals' ? current.arrivals.items : current.departures.items;
  });
  protected readonly tabLabel = computed(() => {
    return this.tab() === 'arrivals' ? 'Arrivées' : 'Départs';
  });
  protected readonly amountLabel = computed(() => {
    return this.tab() === 'departures' ? 'Reste dû' : 'Total';
  });
  protected readonly emptyText = computed(() => {
    return this.tab() === 'arrivals' ? 'Aucune arrivée ce jour-là.' : 'Aucun départ ce jour-là.';
  });

  protected readonly check = computed(() => roomCheck(this.opened()?.item.rooms ?? []));
  protected readonly dirtyWarning = computed(() => dirtyText(this.check().dirty));
  /** No room, or one out of service: the arrival waits for a change of room. */
  protected readonly blocked = computed(() => {
    const opened = this.opened();
    if (opened?.action !== 'check-in') {
      return false;
    }
    return this.check().missing > 0 || this.check().outOfService.length > 0;
  });
  protected readonly needsRoom = computed(() => {
    return this.blocked() || this.check().dirty.length > 0;
  });
  protected readonly confirmLabel = computed(() => {
    const opened = this.opened();
    if (opened === null) {
      return '';
    }
    if (opened.action === 'check-in' && this.check().dirty.length > 0) {
      return 'Enregistrer quand même';
    }
    return ACTION_LABELS[opened.action];
  });

  constructor() {
    void this.load();
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected showDay(date: string): void {
    if (date === '') {
      return;
    }
    this.date.set(date);
    void this.load();
  }

  protected async load(): Promise<void> {
    const request = ++this.request;
    this.problem.set(null);
    this.day.set(null);
    try {
      const day = await this.api.day(this.date());
      if (request !== this.request) {
        return;
      }
      this.day.set(day);
      this.openRequested(day);
    } catch (error) {
      if (request === this.request) {
        this.problem.set(toProblem(error));
      }
    }
  }

  /** The panel asked by `?ouvrir=<id>`: its first action today, on the tab where it is. */
  private openRequested(day: FrontDeskDay): void {
    const id = this.ouvrir();
    if (!this.pendingOpen || id === undefined) {
      return;
    }
    this.pendingOpen = false;
    const departing = day.departures.items.find((item) => item.id === id);
    const arriving = day.arrivals.items.find((item) => item.id === id);
    const item = departing ?? arriving;
    const action = item === undefined ? undefined : this.actions(item)[0];
    if (item !== undefined && action !== undefined) {
      this.tab.set(departing === undefined ? 'arrivals' : 'departures');
      this.open(item, action);
    }
  }

  // --- Items ---

  protected actions(item: FrontDeskItem): FrontDeskAction[] {
    return actionsFor(item, this.today());
  }

  protected actionLabel(action: FrontDeskAction): string {
    return ACTION_LABELS[action];
  }

  protected badge(item: FrontDeskItem): string {
    return statusBadge(item.status);
  }

  protected statusLabel(item: FrontDeskItem): string {
    return STATUS_LABELS[item.status];
  }

  protected lateText(item: FrontDeskItem): string {
    const day = this.tab() === 'arrivals' ? item.checkIn : item.checkOut;
    return `Prévu le ${formatDay(day, true)}`;
  }

  protected headcount(item: FrontDeskItem): string {
    return headcountText(item);
  }

  protected nightsText(item: FrontDeskItem): string {
    return `${item.nights} nuit${item.nights > 1 ? 's' : ''}`;
  }

  protected stayText(item: FrontDeskItem): string {
    const dates = `du ${formatDay(item.checkIn, true)} au ${formatDay(item.checkOut)}`;
    return `${dates} · ${this.nightsText(item)}`;
  }

  protected roomText(line: FrontDeskItem['rooms'][number]): string {
    return roomLineText(line);
  }

  protected feeText(item: FrontDeskItem): string {
    return noShowFeeText(item.ratePlan);
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }

  // --- Side panel ---

  protected open(item: FrontDeskItem, action: FrontDeskAction): void {
    this.opened.set({ item, action });
    this.identityChecked.set(false);
    this.policeFormDone.set(false);
    this.actionProblem.set(null);
    this.panel()?.nativeElement.showModal();
  }

  protected close(): void {
    this.panel()?.nativeElement.close();
  }

  protected async confirm(opened: Opened): Promise<void> {
    const { item, action } = opened;
    this.saving.set(true);
    this.actionProblem.set(null);
    try {
      if (action === 'check-in') {
        const checks: CheckInChecks = {
          identityChecked: this.identityChecked(),
          policeFormDone: this.policeFormDone(),
          acceptDirtyRoom: this.check().dirty.length > 0,
        };
        await this.api.checkIn(item.id, item.version, checks);
        const rooms = item.rooms.map((line) => line.room?.number ?? '').join(', ');
        this.notifier.success(`Arrivée enregistrée pour ${item.customerName}, chambre ${rooms}.`);
      } else if (action === 'check-out') {
        await this.api.checkOut(item.id, item.version);
        this.notifier.success(`Départ enregistré pour ${item.customerName}.`);
      } else {
        const detail = await this.api.noShow(item.id, item.version);
        const fee = formatEuros(detail.cancellationFeeCents);
        const text = `${item.reference} déclarée non présentée ; frais à encaisser : ${fee}.`;
        this.notifier.success(text);
      }
      this.close();
      await this.load();
    } catch (error) {
      const problem = toProblem(error);
      this.actionProblem.set(problem);
      // Changed meanwhile (412): the list is read again, the panel stays open with the message.
      if (problem.status === 412) {
        await this.load();
      }
    } finally {
      this.saving.set(false);
    }
  }
}
