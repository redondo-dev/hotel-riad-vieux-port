import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { daysBetween, type StaySearchCriteria } from '@riad/shared';
import {
  adultsLabel,
  childAgeOptionLabel,
  childrenLabel,
  nightsLabel,
} from '../../core/i18n/counts';
import { formatDate } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';

/** The search in words: arrival, departure, length, and the guests of each room. */
@Component({
  selector: 'rvp-search-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let stay = summary();
    <dl class="grid gap-4 rounded-xl bg-white p-5 shadow-card ring-1 ring-line sm:grid-cols-4">
      <div>
        <dt class="text-sm text-muted" i18n="@@booking.arrival">Arrivée</dt>
        <dd class="mt-1 font-semibold first-letter:uppercase">{{ stay.checkIn }}</dd>
      </div>
      <div>
        <dt class="text-sm text-muted" i18n="@@booking.departure">Départ</dt>
        <dd class="mt-1 font-semibold first-letter:uppercase">{{ stay.checkOut }}</dd>
      </div>
      <div>
        <dt class="text-sm text-muted" i18n="@@booking.length">Durée</dt>
        <dd class="mt-1 font-semibold">{{ stay.nights }}</dd>
      </div>
      <div>
        <dt class="text-sm text-muted" i18n="@@booking.rooms">Chambres</dt>
        <dd class="mt-1">
          <ul class="flex flex-col gap-1 font-semibold">
            @for (room of stay.rooms; track $index) {
              <li>{{ room }}</li>
            }
          </ul>
        </dd>
      </div>
    </dl>
  `,
})
export class SearchSummary {
  readonly criteria = input.required<StaySearchCriteria>();

  private readonly locale = injectLocale();

  protected readonly summary = computed(() => {
    const criteria = this.criteria();
    const dateFormat: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    };
    return {
      checkIn: formatDate(criteria.checkIn, this.locale, dateFormat),
      checkOut: formatDate(criteria.checkOut, this.locale, dateFormat),
      nights: nightsLabel(daysBetween(criteria.checkIn, criteria.checkOut)),
      rooms: criteria.rooms.map((room, index) => {
        const guests =
          room.childrenAges.length === 0
            ? adultsLabel(room.adults)
            : $localize`:@@booking.roomWithChildren:${adultsLabel(room.adults)}:adults: et ${childrenLabel(room.childrenAges.length)}:children: (${room.childrenAges.map(childAgeOptionLabel).join(', ')}:ages:)`;
        return $localize`:@@booking.roomLine:Chambre ${index + 1}:number: : ${guests}:guests:`;
      }),
    };
  });
}
