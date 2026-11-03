import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert } from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { formatEuros } from '../reservations/reservation-model';
import { DashboardApi } from './dashboard-api';
import {
  changeText,
  type Dashboard,
  doneText,
  monthText,
  percentText,
  pointsText,
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

const TREND_BADGES: Record<Trend, string> = {
  up: 'badge-ok',
  down: 'badge-off',
  flat: 'badge-neutral',
};

/**
 * The dashboard of the management (UI/UX specification, D-9): tonight (occupancy, arrivals,
 * departures, incidents still open) and the month (occupancy, room revenue, average rate, nights
 * sold), each figure of the month compared with the whole month before.
 */
@Component({
  selector: 'adm-dashboard-page',
  imports: [RouterLink, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <div class="flex flex-col gap-6">
        <section class="flex flex-col gap-3" aria-labelledby="titre-soir">
          <h2 id="titre-soir" class="text-lg font-semibold">Ce soir</h2>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="card flex flex-col gap-1 p-4">
              <p class="text-sm text-muted">Occupation</p>
              <p class="text-2xl font-semibold">{{ percent(current.today.occupancyPct) }}</p>
              <p class="text-sm text-muted">{{ roomsText() }}</p>
            </div>
            <a routerLink="/aujourdhui" class="card flex flex-col gap-1 p-4 hover:shadow-pop">
              <p class="text-sm text-muted">Arrivées du jour</p>
              <p class="text-2xl font-semibold">{{ current.today.arrivals.total }}</p>
              <p class="text-sm text-muted">{{ arrivalsText() }}</p>
            </a>
            <a routerLink="/aujourdhui" class="card flex flex-col gap-1 p-4 hover:shadow-pop">
              <p class="text-sm text-muted">Départs du jour</p>
              <p class="text-2xl font-semibold">{{ current.today.departures.total }}</p>
              <p class="text-sm text-muted">{{ departuresText() }}</p>
            </a>
            <a routerLink="/pannes" class="card flex flex-col gap-1 p-4 hover:shadow-pop">
              <p class="text-sm text-muted">Pannes ouvertes</p>
              <p class="text-2xl font-semibold">{{ current.incidents.open }}</p>
              <p class="text-sm">
                @if (current.incidents.urgent > 0) {
                  <span class="badge-off">{{ urgentText() }}</span>
                } @else {
                  <span class="text-muted">Aucune urgente</span>
                }
              </p>
            </a>
          </div>
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="titre-mois">
          <div>
            <h2 id="titre-mois" class="text-lg font-semibold first-letter:uppercase">
              {{ month(current.month.month) }}
            </h2>
            <p class="text-sm text-muted">
              Toutes les nuits du mois, passées et à venir, comparées à
              {{ month(current.previousMonth.month) }} entier.
            </p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            @for (tile of monthTiles(); track tile.label) {
              <div class="card flex flex-col gap-1 p-4">
                <p class="text-sm text-muted">{{ tile.label }}</p>
                <p class="text-2xl font-semibold">{{ tile.value }}</p>
                <p class="flex flex-wrap items-center gap-2 text-sm">
                  <span [class]="badge(tile.trend)">{{ tile.change }}</span>
                  <span class="text-muted">vs {{ previousName() }}</span>
                </p>
                @if (tile.note; as note) {
                  <p class="text-sm text-muted">{{ note }}</p>
                }
              </div>
            }
          </div>
        </section>
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

  protected badge(trend: Trend): string {
    return TREND_BADGES[trend];
  }
}
