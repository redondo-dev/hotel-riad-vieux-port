import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChevronLeft, LucideChevronRight, LucideCircleAlert, LucideX } from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { ReservationApi } from '../reservations/reservation-api';
import {
  customerName,
  formatDay,
  formatEuros,
  PAYMENT_LABELS,
  paymentBadge,
  type ReservationDetail,
  STATUS_LABELS,
  statusBadge,
  stayText,
} from '../reservations/reservation-model';
import { PlanningApi } from './planning-api';
import {
  addDays,
  dayHead,
  daysBetween,
  daysFrom,
  dayTitle,
  EVENT_LABELS,
  eventsOn,
  headcountText,
  hotelToday,
  isWeekend,
  lanesOf,
  opensReservations,
  type Planning,
  PLANNING_DAYS,
  PLANNING_STEP,
  type PlanningBlock,
  type PlanningStay,
  sleepsOn,
  spanOf,
  stayLabel,
  stayTone,
} from './planning-model';

/** What the side panel shows. */
type Selection =
  | { kind: 'stay'; stay: PlanningStay; category: string; room: string | null }
  | { kind: 'block'; block: PlanningBlock; category: string; room: string };

/** A stay or a block drawn on the grid. */
interface Bar {
  key: string;
  /** CSS grid column: « 4 / span 3 » (column 1 holds the room numbers). */
  column: string;
  text: string;
  label: string;
  tone: string;
  before: boolean;
  after: boolean;
  selection: Selection;
}

interface GridRow {
  key: string;
  title: string;
  /** A deactivated room, shown while it still holds a stay. */
  inactive: boolean;
  bars: Bar[];
}

interface GridCategory {
  id: string;
  name: string;
  rows: GridRow[];
}

/** One room (or one stay to assign) on the list of a day, for the phone. */
interface DayLine {
  key: string;
  title: string;
  items: { key: string; text: string; tone: string; selection: Selection }[];
}

interface DayCategory {
  id: string;
  name: string;
  lines: DayLine[];
}

const BLOCK_TONE = 'border-danger/30 bg-danger-pale text-danger';
const TO_ASSIGN = 'À attribuer';

/**
 * The planning of the rooms (UI/UX specification, section 5.C): 14 days, a room per line, on a
 * computer; the list of one day on a phone. Read only, every role: housekeeping and technicians
 * see that a room is taken, never by whom (the API leaves the names out for them).
 */
@Component({
  selector: 'adm-planning-page',
  imports: [RouterLink, LucideChevronLeft, LucideChevronRight, LucideCircleAlert, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="card flex flex-wrap items-center gap-2 p-2 max-lg:hidden">
        <button type="button" class="btn-quiet" (click)="shift(-step)">
          <svg lucideChevronLeft></svg>
          {{ step }} jours
        </button>
        <button type="button" class="btn-secondary" (click)="goToday()">Aujourd’hui</button>
        <button type="button" class="btn-quiet" (click)="shift(step)">
          {{ step }} jours
          <svg lucideChevronRight></svg>
        </button>
        <p class="ml-auto px-3 font-semibold">{{ periodText() }}</p>
      </div>

      <div class="card flex items-center gap-2 p-2 lg:hidden">
        <button type="button" class="btn-icon" aria-label="Jour précédent" (click)="moveDay(-1)">
          <svg lucideChevronLeft></svg>
        </button>
        <p class="flex-1 text-center font-semibold first-letter:uppercase">
          {{ dayTitle(selectedDay()) }}
        </p>
        <button type="button" class="btn-icon" aria-label="Jour suivant" (click)="moveDay(1)">
          <svg lucideChevronRight></svg>
        </button>
        <button type="button" class="btn-secondary" (click)="goToday()">Aujourd’hui</button>
      </div>

      @if (problem(); as current) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <div class="flex flex-col items-start gap-2">
            <p>
              <span class="font-semibold">{{ current.title }}.</span> {{ current.detail }}
            </p>
            <button type="button" class="btn-secondary" (click)="load()">Réessayer</button>
          </div>
        </div>
      } @else if (planning() === null) {
        <p class="text-muted" role="status">Chargement du planning…</p>
      } @else {
        <ul class="flex flex-wrap gap-2 text-sm" aria-label="Légende">
          <li class="rounded-md border px-2" [class]="tone('confirmed')">Confirmée</li>
          <li class="rounded-md border px-2" [class]="tone('pending_payment')">En attente</li>
          <li class="rounded-md border px-2" [class]="tone('checked_in')">Arrivé</li>
          <li class="rounded-md border px-2" [class]="tone('checked_out')">Parti</li>
          <li class="rounded-md border px-2" [class]="blockTone">Hors service</li>
        </ul>

        <!-- Scrolls inside itself: the line of the days stays on top while the rooms go by. -->
        <div class="card max-h-[calc(100dvh-12rem)] overflow-auto max-lg:hidden">
          <div class="min-w-[60rem]">
            <div
              class="sticky top-0 z-30 grid border-b border-line bg-white"
              [style.grid-template-columns]="columns"
            >
              <div class="sticky left-0 z-20 bg-white px-3 py-2 text-sm font-semibold">Chambre</div>
              @for (day of days(); track day) {
                <div
                  class="border-l border-line py-1 text-center text-xs"
                  [class.bg-mist]="weekend(day)"
                  [class.bg-info-pale]="day === today()"
                  [class.font-semibold]="day === today()"
                >
                  <span class="block text-muted">{{ head(day).weekday }}</span>
                  <span class="block text-sm">{{ head(day).number }}</span>
                </div>
              }
            </div>

            @for (category of grid(); track category.id) {
              <h2 class="sticky left-0 bg-mist px-3 py-1.5 text-sm font-semibold">
                {{ category.name }}
              </h2>
              @for (row of category.rows; track row.key) {
                <div class="grid border-t border-line" [style.grid-template-columns]="columns">
                  <div
                    class="sticky left-0 z-10 row-start-1 bg-white px-3 py-2 text-sm font-medium"
                    [class.text-muted]="row.inactive"
                    [class.italic]="row.title === toAssign"
                    style="grid-column: 1"
                  >
                    {{ row.title }}
                  </div>
                  @for (day of days(); track day; let index = $index) {
                    <div
                      class="row-start-1 border-l border-line"
                      [class.bg-mist]="weekend(day)"
                      [style.grid-column]="index + 2"
                    ></div>
                  }
                  @for (bar of row.bars; track bar.key) {
                    <button
                      type="button"
                      class="z-[1] row-start-1 my-1 truncate border px-2 text-left text-xs font-medium hover:brightness-95"
                      [class]="bar.tone"
                      [class.rounded-l-md]="!bar.before"
                      [class.rounded-r-md]="!bar.after"
                      [class.ml-1]="!bar.before"
                      [class.mr-1]="!bar.after"
                      [style.grid-column]="bar.column"
                      [attr.aria-label]="bar.label"
                      (click)="open(bar.selection)"
                    >
                      {{ bar.text }}
                    </button>
                  }
                </div>
              }
            } @empty {
              <p class="p-4 text-muted">Aucune chambre à afficher.</p>
            }
          </div>
        </div>

        <div class="flex flex-col gap-4 lg:hidden">
          @for (category of dayList(); track category.id) {
            <section class="card" [attr.aria-label]="category.name">
              <h2 class="border-b border-line px-4 py-3 font-semibold">{{ category.name }}</h2>
              <ul class="divide-y divide-line">
                @for (line of category.lines; track line.key) {
                  <li class="flex min-h-12 items-center gap-3 px-4 py-2">
                    <span class="w-24 shrink-0 font-medium">{{ line.title }}</span>
                    <span class="flex flex-wrap gap-2">
                      @for (item of line.items; track item.key) {
                        <button
                          type="button"
                          class="min-h-9 rounded-md border px-2 text-left text-sm font-medium"
                          [class]="item.tone"
                          (click)="open(item.selection)"
                        >
                          {{ item.text }}
                        </button>
                      } @empty {
                        <span class="text-sm text-muted">Libre</span>
                      }
                    </span>
                  </li>
                }
              </ul>
            </section>
          }
        </div>
      }
    </div>

    <dialog #panel class="side-panel" aria-labelledby="titre-panneau" (close)="selection.set(null)">
      @if (selection(); as chosen) {
        <div class="flex items-start gap-3 border-b border-line p-5">
          <h2 id="titre-panneau" class="flex-1 text-lg font-semibold">{{ panelTitle() }}</h2>
          <button type="button" class="-m-2 btn-icon" aria-label="Fermer" (click)="close()">
            <svg lucideX></svg>
          </button>
        </div>
        <div class="flex flex-col gap-5 p-5">
          @if (chosen.kind === 'stay') {
            <p class="flex flex-wrap gap-2 text-sm">
              <span [class]="badge(chosen.stay)">{{ statusLabel(chosen.stay) }}</span>
              @if (detail(); as current) {
                <span [class]="paymentClass(current)">{{ paymentLabel(current) }}</span>
              }
            </p>
            <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-muted">Chambre</dt>
              <dd>{{ chosen.category }} · {{ chosen.room ?? 'à attribuer' }}</dd>
              <dt class="text-muted">Séjour</dt>
              <dd>{{ stayDates(chosen.stay) }}</dd>
              <dt class="text-muted">Voyageurs</dt>
              <dd>{{ headcount(chosen.stay) }}</dd>
              @if (detail(); as current) {
                <dt class="text-muted">Client</dt>
                <dd>{{ customer(current) }}</dd>
                <dt class="text-muted">Total</dt>
                <dd>{{ euros(current.totalCents) }}</dd>
              }
            </dl>
            @if (detailProblem(); as current) {
              <p class="field-error" role="alert">{{ current.detail }}</p>
            }
            @if (opens()) {
              <a
                class="self-start btn-primary"
                [routerLink]="['/reservations', chosen.stay.reservationId]"
              >
                Ouvrir la fiche
              </a>
            }
          } @else {
            <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-muted">Motif</dt>
              <dd>{{ chosen.block.reason }}</dd>
              <dt class="text-muted">Depuis le</dt>
              <dd>{{ day(chosen.block.from) }}</dd>
              <dt class="text-muted">Retour prévu</dt>
              <dd>{{ chosen.block.to === null ? 'Date inconnue' : day(chosen.block.to) }}</dd>
            </dl>
            @if (chosen.block.incident; as incident) {
              <a class="self-start btn-secondary" [routerLink]="['/pannes', incident.id]">
                Voir la panne {{ incident.reference }}
              </a>
            }
          }
        </div>
      }
    </dialog>
  `,
})
export class PlanningPage {
  private readonly api = inject(PlanningApi);
  private readonly reservations = inject(ReservationApi);
  private readonly session = inject(SessionService);
  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  protected readonly step = PLANNING_STEP;
  protected readonly blockTone = BLOCK_TONE;
  protected readonly toAssign = TO_ASSIGN;
  protected readonly columns = `7rem repeat(${PLANNING_DAYS}, minmax(3.5rem, 1fr))`;

  protected readonly today = signal(hotelToday(new Date()));
  /** First day shown. */
  protected readonly from = signal(this.today());
  /** The day listed on a phone; always one of the days shown. */
  protected readonly selectedDay = signal(this.today());
  protected readonly planning = signal<Planning | null>(null);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly selection = signal<Selection | null>(null);
  protected readonly detail = signal<ReservationDetail | null>(null);
  protected readonly detailProblem = signal<Problem | null>(null);
  protected readonly opens = computed(() => opensReservations(this.session.user()?.role));

  /** Answers of a period left meanwhile are dropped. */
  private request = 0;

  protected readonly days = computed(() => daysFrom(this.from(), PLANNING_DAYS));

  protected readonly periodText = computed(() => {
    const days = this.days();
    const first = days[0] ?? this.from();
    const last = days.at(-1) ?? first;
    const sameMonth = first.slice(0, 7) === last.slice(0, 7);
    const start = sameMonth ? String(Number(first.slice(8))) : formatDay(first, true);
    return `Du ${start} au ${formatDay(last)}`;
  });

  protected readonly grid = computed((): GridCategory[] => {
    const planning = this.planning();
    if (planning === null) {
      return [];
    }
    const first = this.from();
    return planning.categories.map((category) => {
      const rooms = category.rooms.map((room) => {
        const where = { category: category.name, room: room.number };
        const blocks = room.blocks.map((block, index) => {
          const selection: Selection = { kind: 'block', block, ...where };
          const label = `Chambre ${room.number} hors service : ${block.reason}`;
          return this.bar(`b${index}`, block.from, block.to, first, {
            text: 'Hors service',
            label,
            tone: BLOCK_TONE,
            selection,
          });
        });
        const stays = room.stays.map((stay) => this.stayBar(stay, category.name, room.number));
        const bars = [...blocks, ...stays].filter((bar): bar is Bar => bar !== null);
        return { key: room.id, title: room.number, inactive: !room.isActive, bars };
      });
      const lanes = lanesOf(category.unassigned).map((lane, index) => {
        const bars = lane.map((stay) => this.stayBar(stay, category.name, null));
        const shown = bars.filter((bar): bar is Bar => bar !== null);
        return { key: `a${index}`, title: TO_ASSIGN, inactive: false, bars: shown };
      });
      return { id: category.id, name: category.name, rows: [...lanes, ...rooms] };
    });
  });

  protected readonly dayList = computed((): DayCategory[] => {
    const planning = this.planning();
    if (planning === null) {
      return [];
    }
    const day = this.selectedDay();
    return planning.categories.map((category) => {
      const sleeping = category.unassigned.filter((stay) => sleepsOn(stay, day));
      const toAssign = sleeping.map((stay) => {
        const kind = stay.checkIn === day ? 'arrival' : 'staying';
        const items = [this.stayItem(stay, kind, category.name)];
        return { key: stay.lineId, title: TO_ASSIGN, items };
      });
      const rooms = category.rooms.map((room) => {
        const items = eventsOn(room, day).map((event, index) => {
          if (event.kind === 'blocked') {
            const selection: Selection = {
              kind: 'block',
              block: event.block,
              category: category.name,
              room: room.number,
            };
            return { key: `b${index}`, text: EVENT_LABELS.blocked, tone: BLOCK_TONE, selection };
          }
          return this.stayItem(event.stay, event.kind, category.name, room.number);
        });
        return { key: room.id, title: room.number, items };
      });
      return { id: category.id, name: category.name, lines: [...toAssign, ...rooms] };
    });
  });

  protected readonly panelTitle = computed(() => {
    const chosen = this.selection();
    if (chosen === null) {
      return '';
    }
    if (chosen.kind === 'block') {
      return `Chambre ${chosen.room} · hors service`;
    }
    return `${stayLabel(chosen.stay)} · ${chosen.stay.reference}`;
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    const request = ++this.request;
    const from = this.from();
    this.problem.set(null);
    this.planning.set(null);
    try {
      const planning = await this.api.planning(from, addDays(from, PLANNING_DAYS - 1));
      if (request === this.request) {
        this.planning.set(planning);
      }
    } catch (error) {
      if (request === this.request) {
        this.problem.set(toProblem(error));
      }
    }
  }

  protected shift(days: number): void {
    this.showFrom(addDays(this.from(), days));
  }

  protected goToday(): void {
    this.today.set(hotelToday(new Date()));
    this.selectedDay.set(this.today());
    this.showFrom(this.today());
  }

  /** On a phone: the day before or after; the period follows when the day leaves it. */
  protected moveDay(delta: number): void {
    const day = addDays(this.selectedDay(), delta);
    this.selectedDay.set(day);
    const last = addDays(this.from(), PLANNING_DAYS - 1);
    if (day < this.from() || day > last) {
      this.showFrom(delta < 0 ? addDays(day, 1 - PLANNING_DAYS) : day);
    }
  }

  private showFrom(from: string): void {
    this.from.set(from);
    const last = addDays(from, PLANNING_DAYS - 1);
    const day = this.selectedDay();
    if (day < from || day > last) {
      this.selectedDay.set(from);
    }
    void this.load();
  }

  // --- Grid and list ---

  private bar(
    key: string,
    from: string,
    to: string | null,
    first: string,
    content: Pick<Bar, 'text' | 'label' | 'tone' | 'selection'>,
  ): Bar | null {
    const span = spanOf(from, to, first, PLANNING_DAYS);
    if (span === null) {
      return null;
    }
    const column = `${span.start + 2} / span ${span.length}`;
    return { key, column, before: span.before, after: span.after, ...content };
  }

  private stayBar(stay: PlanningStay, category: string, room: string | null): Bar | null {
    const selection: Selection = { kind: 'stay', stay, category, room };
    const where = room === null ? `${category}, à attribuer` : `chambre ${room}`;
    const dates = stayText(stay.checkIn, stay.checkOut, daysBetween(stay.checkIn, stay.checkOut));
    return this.bar(stay.lineId, stay.checkIn, stay.checkOut, this.from(), {
      text: stayLabel(stay),
      label: `${stayLabel(stay)}, ${where}, ${dates}`,
      tone: stayTone(stay.status),
      selection,
    });
  }

  private stayItem(
    stay: PlanningStay,
    kind: 'departure' | 'arrival' | 'staying',
    category: string,
    room: string | null = null,
  ): DayLine['items'][number] {
    const selection: Selection = { kind: 'stay', stay, category, room };
    const text = `${EVENT_LABELS[kind]} · ${stayLabel(stay)}`;
    return { key: `${kind}-${stay.lineId}`, text, tone: stayTone(stay.status), selection };
  }

  // --- Side panel ---

  protected async open(selection: Selection): Promise<void> {
    this.selection.set(selection);
    this.detail.set(null);
    this.detailProblem.set(null);
    this.panel()?.nativeElement.showModal();
    if (selection.kind !== 'stay' || !this.opens()) {
      return;
    }
    // The payment, the full name and the total come with the reservation itself.
    try {
      const detail = await this.reservations.detail(selection.stay.reservationId);
      if (this.selection() === selection) {
        this.detail.set(detail);
      }
    } catch (error) {
      if (this.selection() === selection) {
        this.detailProblem.set(toProblem(error));
      }
    }
  }

  protected close(): void {
    this.panel()?.nativeElement.close();
  }

  // --- Texts ---

  protected head(day: string): { weekday: string; number: string } {
    return dayHead(day);
  }

  protected dayTitle(day: string): string {
    return dayTitle(day);
  }

  protected day(day: string): string {
    return formatDay(day);
  }

  protected weekend(day: string): boolean {
    return isWeekend(day);
  }

  protected tone(status: PlanningStay['status']): string {
    return stayTone(status);
  }

  protected badge(stay: PlanningStay): string {
    return statusBadge(stay.status);
  }

  protected statusLabel(stay: PlanningStay): string {
    return STATUS_LABELS[stay.status];
  }

  protected paymentClass(detail: ReservationDetail): string {
    return paymentBadge(detail.paymentStatus);
  }

  protected paymentLabel(detail: ReservationDetail): string {
    return PAYMENT_LABELS[detail.paymentStatus];
  }

  protected stayDates(stay: PlanningStay): string {
    return stayText(stay.checkIn, stay.checkOut, daysBetween(stay.checkIn, stay.checkOut));
  }

  protected headcount(stay: PlanningStay): string {
    return headcountText(stay);
  }

  protected customer(detail: ReservationDetail): string {
    return customerName(detail.customer);
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }
}
