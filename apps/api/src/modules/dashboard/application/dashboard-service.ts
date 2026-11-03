import type { Sequelize } from 'sequelize';
import { addDays } from '../../catalog/domain/pricing.ts';
import { FrontDesk } from '../../reservations/application/front-desk.ts';
import { figuresOf, monthsAround, type PeriodFigures } from '../domain/dashboard-rules.ts';
import { DashboardRepository } from '../infrastructure/dashboard-repository.ts';

export interface MonthFigures extends PeriodFigures {
  /** « 2026-11 ». */
  month: string;
}

export interface Dashboard {
  date: string;
  today: {
    roomsInService: number;
    roomsSold: number;
    occupancyPct: number;
    /** Same counters as the « Today » screen. */
    arrivals: { total: number; done: number };
    departures: { total: number; done: number };
  };
  month: MonthFigures;
  /** The month before, to compare (whole month). */
  previousMonth: MonthFigures;
  incidents: { open: number; urgent: number };
}

/**
 * The dashboard of the management (UI/UX specification, D-9): the occupancy of the night of
 * `date` and of its month, the room revenue and the average rate of the month, each compared with
 * the month before, the arrivals and departures of the day, the incidents still open. Read only.
 */
export class DashboardService {
  readonly #repository: DashboardRepository;
  readonly #frontDesk: FrontDesk;

  constructor(sequelize: Sequelize, today: () => string) {
    this.#repository = new DashboardRepository(sequelize);
    this.#frontDesk = new FrontDesk(sequelize, today);
  }

  async dashboard(date: string): Promise<Dashboard> {
    const { current, previous } = monthsAround(date);
    // One after the other: a single connection is enough, and the pool stays free.
    const tonight = figuresOf(await this.#repository.period(date, addDays(date, 1)));
    const month = figuresOf(await this.#repository.period(current.from, current.to));
    const before = figuresOf(await this.#repository.period(previous.from, previous.to));
    const day = await this.#frontDesk.day(date);
    const incidents = await this.#repository.openIncidents();
    return {
      date,
      today: {
        roomsInService: tonight.roomNightsAvailable,
        roomsSold: tonight.roomNightsSold,
        occupancyPct: tonight.occupancyPct,
        arrivals: { total: day.arrivals.total, done: day.arrivals.done },
        departures: { total: day.departures.total, done: day.departures.done },
      },
      month: { month: current.month, ...month },
      previousMonth: { month: previous.month, ...before },
      incidents,
    };
  }
}
