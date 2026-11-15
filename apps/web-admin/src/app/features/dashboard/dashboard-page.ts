import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideBed,
  LucideCircleAlert,
  LucideLogIn,
  LucideLogOut,
  LucideWrench,
} from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { formatEuros } from '../reservations/reservation-model';
import { DashboardApi } from './dashboard-api';
import {
  changeText,
  comparisonBarsOf,
  type Dashboard,
  donutOf,
  doneText,
  monthText,
  percentText,
  pointsText,
  progressOf,
  type Trend,
  trendOf,
} from './dashboard-model';

/** One figure of the month, with its change since the month before. */
interface MonthTile {
  label: string;
  value: string;
  change: string;
  trend: Trend;
  note: string | null;
}

/** One pair of bars, placed in the drawing (SVG units). */
interface PlacedBar {
  label: string;
  x: number;
  beforeY: number;
  beforeHeight: number;
  nowY: number;
  nowHeight: number;
}

const TREND_BADGES: Record<Trend, string> = {
  up: 'badge-ok',
  down: 'badge-off',
  flat: 'badge-neutral',
};

/** Ring of tonight: radius and length of its circle (SVG units). */
const RING_RADIUS = 54;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Bar chart: bottom line and tallest bar (SVG units). */
const CHART_BASE = 160;
const CHART_HEIGHT = 140;

/**
 * The dashboard of the management (UI/UX specification, D-9), in its dark look (step T-1, on
 * this page only for now): tonight in four coloured tiles, the ring of the rooms sold, the
 * arrivals and departures done, and the month compared with the whole month before. The charts
 * are plain SVG, each with a text read by screen readers.
 */
@Component({
  selector: 'adm-dashboard-page',
  imports: [RouterLink, LucideBed, LucideCircleAlert, LucideLogIn, LucideLogOut, LucideWrench],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .dash {
      --dash-bg: #1b1a2e;
      --dash-card: #25243d;
      --dash-line: #37365a;
      --dash-muted: #b4b2d4;
      --dash-blue: #4f8df7;
      --dash-before: #7a78a8;
      border-radius: 1rem;
      background: var(--dash-bg);
      color: #fff;
    }
    .dash-card {
      border: 1px solid var(--dash-line);
      border-radius: 0.875rem;
      background: var(--dash-card);
    }
    .dash-muted {
      color: var(--dash-muted);
    }
    .tile {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      border-radius: 0.875rem;
      padding: 1.25rem;
      color: #fff;
      transition:
        transform 0.15s ease,
        box-shadow 0.15s ease;
    }
    a.tile:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 24px rgb(0 0 0 / 0.35);
    }
    .tile-icon {
      width: 2.75rem;
      height: 2.75rem;
      flex-shrink: 0;
      opacity: 0.9;
    }
    /* Shades darkened from the model, so that the text stays readable (WCAG AA). */
    .tile-blue {
      background: linear-gradient(135deg, #1f78c1, #1a5fae);
    }
    .tile-green {
      background: linear-gradient(135deg, #16824a, #0f6b3c);
    }
    .tile-yellow {
      background: linear-gradient(135deg, #ffcd3c, #f7b733);
      color: #1c1a14;
    }
    .tile-orange {
      background: linear-gradient(135deg, #c94a1a, #b3301f);
    }
    .bar-track {
      height: 0.625rem;
      overflow: hidden;
      border-radius: 9999px;
      background: var(--dash-line);
    }
    .bar-fill {
      height: 100%;
      border-radius: 9999px;
    }
    .dot {
      display: inline-block;
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 9999px;
    }
  `,
  template: `
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
    } @else if (dashboard(); as current) {
      <div class="dash flex flex-col gap-6 p-4 sm:p-6">
        <section class="flex flex-col gap-3" aria-labelledby="titre-soir">
          <h2 id="titre-soir" class="text-lg font-semibold">Ce soir</h2>
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div class="tile tile-blue">
              <div>
                <p class="text-3xl font-bold">{{ percent(current.today.occupancyPct) }}</p>
                <p class="font-medium">Occupation</p>
                <p class="text-sm opacity-90">{{ roomsText() }}</p>
              </div>
              <svg lucideBed class="tile-icon" aria-hidden="true"></svg>
            </div>
            <a routerLink="/aujourdhui" class="tile tile-green">
              <div>
                <p class="text-3xl font-bold">{{ current.today.arrivals.total }}</p>
                <p class="font-medium">Arrivées du jour</p>
                <p class="text-sm opacity-90">{{ arrivalsText() }}</p>
              </div>
              <svg lucideLogIn class="tile-icon" aria-hidden="true"></svg>
            </a>
            <a routerLink="/aujourdhui" class="tile tile-yellow">
              <div>
                <p class="text-3xl font-bold">{{ current.today.departures.total }}</p>
                <p class="font-medium">Départs du jour</p>
                <p class="text-sm">{{ departuresText() }}</p>
              </div>
              <svg lucideLogOut class="tile-icon" aria-hidden="true"></svg>
            </a>
            <a routerLink="/pannes" class="tile tile-orange">
              <div>
                <p class="text-3xl font-bold">{{ current.incidents.open }}</p>
                <p class="font-medium">Pannes ouvertes</p>
                <p class="text-sm opacity-90">
                  {{ current.incidents.urgent > 0 ? urgentText() : 'Aucune urgente' }}
                </p>
              </div>
              <svg lucideWrench class="tile-icon" aria-hidden="true"></svg>
            </a>
          </div>
        </section>

        <div class="grid gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4">
            <section
              class="dash-card flex flex-col items-center gap-3 p-5"
              aria-labelledby="titre-anneau"
            >
              <h2 id="titre-anneau" class="self-start font-semibold">Occupation ce soir</h2>
              <svg
                viewBox="0 0 140 140"
                class="h-40 w-40"
                role="img"
                [attr.aria-label]="ringLabel()"
              >
                <circle
                  cx="70"
                  cy="70"
                  [attr.r]="ringRadius"
                  fill="none"
                  style="stroke: var(--dash-line)"
                  stroke-width="16"
                />
                <circle
                  cx="70"
                  cy="70"
                  [attr.r]="ringRadius"
                  fill="none"
                  style="stroke: var(--dash-blue)"
                  stroke-width="16"
                  stroke-linecap="round"
                  transform="rotate(-90 70 70)"
                  [attr.stroke-dasharray]="ringDash()"
                />
                <text
                  x="70"
                  y="68"
                  text-anchor="middle"
                  fill="#fff"
                  font-size="22"
                  font-weight="700"
                >
                  {{ percent(current.today.occupancyPct) }}
                </text>
                <text
                  x="70"
                  y="90"
                  text-anchor="middle"
                  style="fill: var(--dash-muted)"
                  font-size="11"
                >
                  vendues
                </text>
              </svg>
              <p class="text-2xl font-bold">{{ donut().free }}</p>
              <p class="dash-muted -mt-2 text-sm">chambres libres ce soir</p>
            </section>

            <section class="dash-card flex flex-col gap-4 p-5" aria-labelledby="titre-jour">
              <h2 id="titre-jour" class="font-semibold">Aujourd’hui</h2>
              <div class="flex flex-col gap-1.5">
                <p class="flex justify-between text-sm">
                  <span>Arrivées faites</span>
                  <span class="dash-muted">{{ doneOf(current.today.arrivals) }}</span>
                </p>
                <div class="bar-track" role="presentation">
                  <div
                    class="bar-fill"
                    style="background: #f4b400"
                    [style.width.%]="arrivalsPct()"
                  ></div>
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <p class="flex justify-between text-sm">
                  <span>Départs faits</span>
                  <span class="dash-muted">{{ doneOf(current.today.departures) }}</span>
                </p>
                <div class="bar-track" role="presentation">
                  <div
                    class="bar-fill"
                    style="background: #34c38f"
                    [style.width.%]="departuresPct()"
                  ></div>
                </div>
              </div>
              <p class="flex flex-wrap gap-4 text-sm">
                <span class="flex items-center gap-1.5">
                  <span class="dot" style="background: #f4b400"></span> Arrivées
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="dot" style="background: #34c38f"></span> Départs
                </span>
              </p>
            </section>
          </div>

          <section
            class="dash-card flex flex-col gap-4 p-5 lg:col-span-2"
            aria-labelledby="titre-mois"
          >
            <div>
              <h2 id="titre-mois" class="font-semibold first-letter:uppercase">
                {{ nowName() }} vs {{ previousName() }}
              </h2>
              <p class="dash-muted text-sm">
                Toutes les nuits de {{ month(current.month.month) }}, passées et à venir, comparées
                à {{ month(current.previousMonth.month) }} entier.
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              @for (tile of monthTiles(); track tile.label) {
                <div class="flex flex-col gap-1">
                  <p class="dash-muted text-sm">{{ tile.label }}</p>
                  <p class="text-xl font-bold">{{ tile.value }}</p>
                  <p class="text-sm">
                    <span [class]="badge(tile.trend)">{{ tile.change }}</span>
                  </p>
                  @if (tile.note; as note) {
                    <p class="dash-muted text-xs">{{ note }}</p>
                  }
                </div>
              }
            </div>
            <svg viewBox="0 0 400 190" class="w-full" role="img" [attr.aria-label]="chartLabel()">
              @for (line of gridLines; track line) {
                <line
                  x1="0"
                  x2="400"
                  [attr.y1]="line"
                  [attr.y2]="line"
                  style="stroke: var(--dash-line)"
                />
              }
              @for (bar of placedBars(); track bar.label) {
                <g>
                  <rect
                    [attr.x]="bar.x"
                    [attr.y]="bar.beforeY"
                    width="26"
                    [attr.height]="bar.beforeHeight"
                    rx="4"
                    style="fill: var(--dash-before)"
                  />
                  <rect
                    [attr.x]="bar.x + 32"
                    [attr.y]="bar.nowY"
                    width="26"
                    [attr.height]="bar.nowHeight"
                    rx="4"
                    style="fill: var(--dash-blue)"
                  />
                  <text
                    [attr.x]="bar.x + 29"
                    y="180"
                    text-anchor="middle"
                    style="fill: var(--dash-muted)"
                    font-size="11"
                  >
                    {{ bar.label }}
                  </text>
                </g>
              }
            </svg>
            <p class="flex flex-wrap gap-4 text-sm">
              <span class="flex items-center gap-1.5">
                <span class="dot" style="background: var(--dash-before)"></span>
                <span class="first-letter:uppercase">{{ previousName() }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <span class="dot" style="background: var(--dash-blue)"></span>
                <span class="first-letter:uppercase">{{ nowName() }}</span>
              </span>
              <span class="dash-muted">Chaque paire est à l’échelle de sa plus grande valeur.</span>
            </p>
          </section>
        </div>
      </div>
    } @else {
      <p class="text-muted" role="status">Chargement du tableau de bord…</p>
    }
  `,
})
export class DashboardPage {
  private readonly api = inject(DashboardApi);

  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly roomsText = computed(() => {
    const today = this.dashboard()?.today;
    return today === undefined ? '' : `${today.roomsSold} chambres sur ${today.roomsInService}`;
  });
  protected readonly arrivalsText = computed(() => {
    const today = this.dashboard()?.today;
    return today === undefined ? '' : doneText(today.arrivals, true);
  });
  protected readonly departuresText = computed(() => {
    const today = this.dashboard()?.today;
    return today === undefined ? '' : doneText(today.departures, false);
  });
  protected readonly urgentText = computed(() => {
    const urgent = this.dashboard()?.incidents.urgent ?? 0;
    return `dont ${urgent} urgente${urgent > 1 ? 's' : ''}`;
  });
  /** « novembre » (the month, without its year). */
  protected readonly nowName = computed(() => {
    const now = this.dashboard()?.month.month;
    return now === undefined ? '' : monthText(now).split(' ')[0];
  });
  /** « octobre » (the month before, without its year). */
  protected readonly previousName = computed(() => {
    const previous = this.dashboard()?.previousMonth.month;
    return previous === undefined ? '' : monthText(previous).split(' ')[0];
  });

  protected readonly monthTiles = computed((): MonthTile[] => {
    const current = this.dashboard();
    if (current === null) {
      return [];
    }
    const { month: now, previousMonth: before } = current;
    const feesText = `dont frais d’annulation : ${formatEuros(now.feesCents)}`;
    const fees = now.feesCents > 0 ? feesText : null;
    return [
      {
        label: 'Occupation du mois',
        value: percentText(now.occupancyPct),
        change: pointsText(now.occupancyPct, before.occupancyPct),
        trend: trendOf(now.occupancyPct, before.occupancyPct),
        note: `${now.roomNightsSold} nuits vendues sur ${now.roomNightsAvailable}`,
      },
      {
        label: 'Chiffre d’affaires hébergement',
        value: formatEuros(now.revenueCents),
        change: changeText(now.revenueCents, before.revenueCents),
        trend: trendOf(now.revenueCents, before.revenueCents),
        note: fees,
      },
      {
        label: 'Prix moyen par nuit',
        value: formatEuros(now.averageRateCents),
        change: changeText(now.averageRateCents, before.averageRateCents),
        trend: trendOf(now.averageRateCents, before.averageRateCents),
        note: null,
      },
      {
        label: 'Nuits vendues',
        value: String(now.roomNightsSold),
        change: changeText(now.roomNightsSold, before.roomNightsSold),
        trend: trendOf(now.roomNightsSold, before.roomNightsSold),
        note: null,
      },
    ];
  });

  // --- Charts ---

  protected readonly ringRadius = RING_RADIUS;
  protected readonly gridLines = [20, 55, 90, 125, CHART_BASE];

  protected readonly donut = computed(() => {
    const today = this.dashboard()?.today;
    return today === undefined ? donutOf(0, 0) : donutOf(today.roomsSold, today.roomsInService);
  });
  /** The part of the circle drawn, then the rest left empty. */
  protected readonly ringDash = computed(() => {
    const drawn = this.donut().fraction * RING_LENGTH;
    return `${drawn} ${RING_LENGTH}`;
  });
  protected readonly ringLabel = computed(() => {
    const today = this.dashboard()?.today;
    if (today === undefined) {
      return '';
    }
    const occupancy = percentText(today.occupancyPct);
    return `Occupation ce soir : ${occupancy}, ${this.donut().free} chambres libres`;
  });
  protected readonly arrivalsPct = computed(() => {
    const today = this.dashboard()?.today;
    return today === undefined ? 0 : progressOf(today.arrivals);
  });
  protected readonly departuresPct = computed(() => {
    const today = this.dashboard()?.today;
    return today === undefined ? 0 : progressOf(today.departures);
  });

  protected readonly placedBars = computed((): PlacedBar[] => {
    const current = this.dashboard();
    if (current === null) {
      return [];
    }
    return comparisonBarsOf(current.month, current.previousMonth).map((bar, index) => {
      const beforeHeight = (bar.before / 100) * CHART_HEIGHT;
      const nowHeight = (bar.now / 100) * CHART_HEIGHT;
      return {
        label: bar.label,
        x: index * 100 + 21,
        beforeY: CHART_BASE - beforeHeight,
        beforeHeight,
        nowY: CHART_BASE - nowHeight,
        nowHeight,
      };
    });
  });
  /** What the bar chart shows, for the screen readers: the four figures of both months. */
  protected readonly chartLabel = computed(() => {
    const current = this.dashboard();
    if (current === null) {
      return '';
    }
    const { month: now, previousMonth: before } = current;
    return (
      `Comparaison ${this.previousName()} et ${this.nowName()} : ` +
      `occupation ${percentText(before.occupancyPct)} puis ${percentText(now.occupancyPct)}, ` +
      `chiffre d’affaires ${formatEuros(before.revenueCents)} puis ` +
      `${formatEuros(now.revenueCents)}, prix moyen ${formatEuros(before.averageRateCents)} ` +
      `puis ${formatEuros(now.averageRateCents)}, nuits vendues ${before.roomNightsSold} puis ` +
      `${now.roomNightsSold}.`
    );
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.problem.set(null);
    try {
      this.dashboard.set(await this.api.dashboard());
    } catch (error) {
      this.problem.set(toProblem(error));
    }
  }

  protected percent(value: number): string {
    return percentText(value);
  }

  protected month(month: string): string {
    return monthText(month);
  }

  /** « 3 sur 4 ». */
  protected doneOf(count: { total: number; done: number }): string {
    return `${count.done} sur ${count.total}`;
  }

  protected badge(trend: Trend): string {
    return TREND_BADGES[trend];
  }
}
