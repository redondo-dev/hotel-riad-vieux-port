import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { addMonths, daysBetween, startOfMonth, type IsoDate } from '@riad/shared';
import { CalendarDays, ChevronLeft, ChevronRight, LucideAngularModule, X } from 'lucide-angular';
import { nightsLabel } from '../../../core/i18n/counts';
import { formatDate } from '../../../core/i18n/format';
import { INTL_LOCALE, injectLocale } from '../../../core/i18n/locale';
import {
  buildMonth,
  dateAfterKey,
  formatTypedDate,
  parseTypedDate,
  weekdayNames,
} from './calendar';

/**
 * Stay dates field (UI/UX specification 4.A): a single button that opens a dialog with a
 * calendar — two months from 640 px, one month on phones — and two text fields to type the
 * dates as DD/MM/YYYY. First click = arrival, second click = departure.
 *
 * The native <dialog> element provides focus trapping, the Escape key and the backdrop.
 * Days use a roving tabindex and are navigable with the arrow keys, Page Up/Down, Home/End.
 */
@Component({
  selector: 'rvp-date-range-field',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './date-range-field.html',
})
export class DateRangeField {
  readonly fieldId = input.required<string>();
  readonly today = input.required<IsoDate>();
  /** Last date that can be clicked; business limits are checked by the search form. */
  readonly lastSelectableDate = input.required<IsoDate>();
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);
  readonly checkIn = model<IsoDate | null>(null);
  readonly checkOut = model<IsoDate | null>(null);

  private readonly locale = injectLocale();
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly icons = {
    calendar: CalendarDays,
    close: X,
    previous: ChevronLeft,
    next: ChevronRight,
  };
  protected readonly weekdays = weekdayNames(INTL_LOCALE[this.locale]);
  protected readonly isOpen = signal(false);
  protected readonly monthsShown = signal(1);
  protected readonly viewStart = signal<IsoDate | null>(null);
  protected readonly focusDate = signal<IsoDate | null>(null);
  protected readonly typedError = signal<'arrival' | 'departure' | null>(null);

  protected readonly months = computed(() => {
    const start = this.viewStart();
    if (start === null) {
      return [];
    }
    return Array.from({ length: this.monthsShown() }, (_, index) =>
      buildMonth(addMonths(start, index)),
    );
  });

  protected readonly canGoBack = computed(() => {
    const start = this.viewStart();
    return start !== null && start > startOfMonth(this.today());
  });

  protected readonly nights = computed(() => {
    const checkIn = this.checkIn();
    const checkOut = this.checkOut();
    return checkIn !== null && checkOut !== null && checkOut > checkIn
      ? daysBetween(checkIn, checkOut)
      : null;
  });

  /** Text of the closed field: « jeu. 12 nov. → dim. 15 nov. · 3 nuits ». */
  protected readonly summary = computed(() => {
    const checkIn = this.checkIn();
    const checkOut = this.checkOut();
    const nights = this.nights();
    if (checkIn === null) {
      return $localize`:@@dates.placeholder:Choisir vos dates`;
    }
    const from = this.shortDate(checkIn);
    if (checkOut === null) {
      return $localize`:@@dates.summaryArrivalOnly:Arrivée ${from}:from: · départ à choisir`;
    }
    const to = this.shortDate(checkOut);
    return nights === null
      ? `${from} → ${to}`
      : $localize`:@@dates.summary:${from}:from: → ${to}:to: · ${nightsLabel(nights)}:nights:`;
  });

  /** Guidance shown and announced while choosing. */
  protected readonly selectionHint = computed(() => {
    const checkIn = this.checkIn();
    const nights = this.nights();
    if (checkIn === null) {
      return $localize`:@@dates.hintArrival:Choisissez votre date d'arrivée.`;
    }
    if (this.checkOut() === null || nights === null) {
      return $localize`:@@dates.hintDeparture:Arrivée le ${this.longDate(checkIn)}:date:. Choisissez votre date de départ.`;
    }
    return $localize`:@@dates.hintDone:Séjour de ${nightsLabel(nights)}:nights:.`;
  });

  protected readonly datePlaceholder = $localize`:@@dates.pattern:JJ/MM/AAAA`;

  constructor() {
    // Two months side by side from 640 px. Browser only: the server renders the closed field.
    afterNextRender(() => {
      const query = window.matchMedia('(min-width: 640px)');
      const update = (): void => {
        this.monthsShown.set(query.matches ? 2 : 1);
      };
      update();
      query.addEventListener('change', update);
      this.destroyRef.onDestroy(() => {
        query.removeEventListener('change', update);
      });
    });
  }

  /** Moves focus to the field, for example from the error summary. */
  focus(): void {
    this.trigger().nativeElement.focus();
  }

  protected open(): void {
    const start = this.checkIn() ?? this.today();
    this.focusDate.set(start);
    this.viewStart.set(startOfMonth(start));
    this.typedError.set(null);
    this.dialog().nativeElement.showModal();
    this.isOpen.set(true);
    this.focusActiveDay();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected onClosed(): void {
    this.isOpen.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onDialogClick(event: MouseEvent): void {
    // A click on the backdrop targets the <dialog> itself, not its content.
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }

  protected clear(): void {
    this.checkIn.set(null);
    this.checkOut.set(null);
    this.typedError.set(null);
  }

  protected shiftMonth(step: number): void {
    const start = this.viewStart();
    if (start === null || (step < 0 && !this.canGoBack())) {
      return;
    }
    this.viewStart.set(addMonths(start, step));
  }

  protected pick(date: IsoDate): void {
    if (!this.isSelectable(date)) {
      return;
    }
    this.focusDate.set(date);
    const checkIn = this.checkIn();
    if (checkIn === null || this.checkOut() !== null || date <= checkIn) {
      this.checkIn.set(date);
      this.checkOut.set(null);
    } else {
      this.checkOut.set(date);
      this.close();
    }
    this.typedError.set(null);
  }

  protected onDayKeydown(event: KeyboardEvent, date: IsoDate): void {
    const next = dateAfterKey(date, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    this.focusDate.set(next);
    this.showMonthOf(next);
    this.focusActiveDay();
  }

  protected onArrivalTyped(text: string): void {
    if (text.trim() === '') {
      return;
    }
    const date = parseTypedDate(text);
    if (date === null) {
      this.typedError.set('arrival');
      return;
    }
    this.typedError.set(null);
    this.checkIn.set(date);
    const checkOut = this.checkOut();
    if (checkOut !== null && checkOut <= date) {
      this.checkOut.set(null);
    }
    this.focusDate.set(date);
    this.showMonthOf(date);
  }

  protected onDepartureTyped(text: string): void {
    if (text.trim() === '') {
      return;
    }
    const date = parseTypedDate(text);
    if (date === null) {
      this.typedError.set('departure');
      return;
    }
    this.typedError.set(null);
    this.checkOut.set(date);
    this.focusDate.set(date);
    this.showMonthOf(date);
  }

  protected typedValue(date: IsoDate | null): string {
    return date === null ? '' : formatTypedDate(date);
  }

  protected isSelectable(date: IsoDate): boolean {
    return date >= this.today() && date <= this.lastSelectableDate();
  }

  protected isEndpoint(date: IsoDate): boolean {
    return date === this.checkIn() || date === this.checkOut();
  }

  protected isInRange(date: IsoDate): boolean {
    const checkIn = this.checkIn();
    const checkOut = this.checkOut();
    return checkIn !== null && checkOut !== null && date > checkIn && date < checkOut;
  }

  protected monthTitle(monthStart: IsoDate): string {
    return formatDate(monthStart, this.locale, { month: 'long', year: 'numeric' });
  }

  protected dayNumber(date: IsoDate): number {
    return Number(date.slice(8, 10));
  }

  /** Full name read by screen readers, with the role of the day in the selection. */
  protected dayLabel(date: IsoDate): string {
    let label = this.longDate(date);
    if (date === this.checkIn()) {
      label += $localize`:@@dates.dayIsArrival:, date d'arrivée`;
    } else if (date === this.checkOut()) {
      label += $localize`:@@dates.dayIsDeparture:, date de départ`;
    }
    if (!this.isSelectable(date)) {
      label += $localize`:@@dates.dayUnavailable:, non disponible`;
    }
    return label;
  }

  private showMonthOf(date: IsoDate): void {
    const first = this.viewStart();
    const target = startOfMonth(date);
    if (first === null || target < first) {
      this.viewStart.set(target);
      return;
    }
    const last = addMonths(first, this.monthsShown() - 1);
    if (target > last) {
      this.viewStart.set(addMonths(target, -(this.monthsShown() - 1)));
    }
  }

  private focusActiveDay(): void {
    afterNextRender(
      () => {
        const date = this.focusDate();
        this.dialog()
          .nativeElement.querySelector<HTMLButtonElement>(`[data-date="${date ?? ''}"]`)
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  private shortDate(date: IsoDate): string {
    return formatDate(date, this.locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  private longDate(date: IsoDate): string {
    return formatDate(date, this.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
}
