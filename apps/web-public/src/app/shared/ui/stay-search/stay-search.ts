import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  Injector,
  input,
  type OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  nowInTimeZone,
  toSearchQueryParams,
  validateStaySearch,
  type IsoDate,
  type RoomDraft,
  type RoomOccupancy,
  type StaySearchCriteria,
  type StaySearchError,
} from '@riad/shared';
import { CircleAlert, LucideAngularModule, Search } from 'lucide-angular';
import { CatalogService } from '../../../core/data/catalog.service';
import { BOOKING_PATH } from '../../../core/navigation';
import { DateRangeField } from './date-range-field';
import { GuestsPicker } from './guests-picker';
import { staySearchErrorMessage } from './stay-search-messages';

/** A copy the form can change without touching the search it came from. */
function draftOf(rooms: readonly RoomOccupancy[]): RoomDraft[] {
  return rooms.map((room) => ({ adults: room.adults, childrenAges: [...room.childrenAges] }));
}

/**
 * Stay search (UI/UX specification 4.A), reused on the home page, the 404 page and, later,
 * the rooms pages. The rules come from `@riad/shared`, the same ones the API will apply.
 * Errors appear only after a first submission, then update as the visitor corrects them.
 */
@Component({
  selector: 'rvp-stay-search',
  imports: [LucideAngularModule, DateRangeField, GuestsPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stay-search.html',
})
export class StaySearch implements OnInit {
  /** Prefix of the element ids, to keep them unique on the page. */
  readonly idPrefix = input('search');
  /** Heading level of the visually hidden title, to fit the page outline. */
  readonly headingLevel = input<2 | 3>(2);
  /** A search to show again (results page): the form starts from it. */
  readonly initial = input<StaySearchCriteria | null>(null);

  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly rules = this.catalog.bookingRules;
  protected readonly timeZone = this.catalog.hotel.timeZone;
  private readonly dateField = viewChild.required(DateRangeField);
  private readonly guestsField = viewChild.required(GuestsPicker);
  private readonly errorSummary = viewChild<ElementRef<HTMLElement>>('errorSummary');

  protected readonly icons = { search: Search, alert: CircleAlert };
  /** Days that can be clicked in the calendar: the booking horizon plus the longest stay. */
  protected readonly selectableDays = this.rules.bookingHorizonDays + this.rules.maxStayNights;
  /** Arrivals only up to the booking horizon: later days can only be departures. */
  protected readonly arrivalDays = this.rules.bookingHorizonDays;

  protected readonly checkIn = signal<IsoDate | null>(null);
  protected readonly checkOut = signal<IsoDate | null>(null);
  protected readonly rooms = signal<RoomDraft[]>([{ adults: 2, childrenAges: [] }]);
  private readonly submitted = signal(false);

  ngOnInit(): void {
    const initial = this.initial();
    if (initial !== null) {
      this.checkIn.set(initial.checkIn);
      this.checkOut.set(initial.checkOut);
      this.rooms.set(draftOf(initial.rooms));
    }
  }

  protected readonly errors = computed<StaySearchError[]>(() => {
    if (!this.submitted()) {
      return [];
    }
    return validateStaySearch(
      { checkIn: this.checkIn(), checkOut: this.checkOut(), rooms: this.rooms() },
      this.rules,
      nowInTimeZone(this.timeZone),
    );
  });

  protected readonly dateErrors = computed(() =>
    this.errors().filter((error) => error.field === 'checkIn' || error.field === 'checkOut'),
  );
  protected readonly guestErrors = computed(() =>
    this.errors().filter((error) => error.field !== 'checkIn' && error.field !== 'checkOut'),
  );

  protected readonly errorTitle = computed(() =>
    this.errors().length === 1
      ? $localize`:@@search.errorTitle.one:1 point est à corriger`
      : $localize`:@@search.errorTitle.other:${this.errors().length}:count: points sont à corriger`,
  );

  protected message(error: StaySearchError): string {
    return staySearchErrorMessage(error, {
      maxStayNights: this.rules.maxStayNights,
      bookingHorizonDays: this.rules.bookingHorizonDays,
      phone: this.catalog.hotel.phone.display,
    });
  }

  protected focusFieldOf(error: StaySearchError): void {
    if (error.field === 'checkIn' || error.field === 'checkOut') {
      this.dateField().focus();
    } else {
      this.guestsField().focus();
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    const errors = this.errors();
    const checkIn = this.checkIn();
    const checkOut = this.checkOut();

    if (errors.length > 0 || checkIn === null || checkOut === null) {
      afterNextRender(() => this.errorSummary()?.nativeElement.focus(), {
        injector: this.injector,
      });
      return;
    }

    const rooms = this.rooms().map((room) => ({
      adults: room.adults,
      childrenAges: room.childrenAges.filter((age): age is number => age !== null),
    }));
    void this.router.navigate(['/', BOOKING_PATH], {
      queryParams: toSearchQueryParams({ checkIn, checkOut, rooms }),
    });
  }
}
