import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { daysBetween, fromSearchQueryParams } from '@riad/shared';
import { CircleAlert, Construction, LucideAngularModule } from 'lucide-angular';
import {
  adultsLabel,
  childAgeOptionLabel,
  childrenLabel,
  nightsLabel,
} from '../../core/i18n/counts';
import { formatDate } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { SEARCH_ANCHOR } from '../../core/navigation';

/**
 * TEMPORARY SCREEN — target of the "Search" button until booking step 1 (availability and
 * rates) is built. It says so plainly and only echoes the visitor's search: no availability
 * and no price is computed or implied.
 */
@Component({
  selector: 'rvp-booking-in-progress-page',
  imports: [LucideAngularModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-page max-w-3xl py-12 sm:py-16">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@booking.title">
        Votre recherche
      </h1>

      <div class="mt-6 flex gap-3 rounded-lg border-l-4 border-port bg-info-pale p-4" role="status">
        <lucide-icon
          [img]="icons.construction"
          [size]="24"
          class="shrink-0 text-port"
          aria-hidden="true"
        />
        <div>
          <p class="font-semibold" i18n="@@booking.inProgressTitle">
            Étape de réservation en cours de développement
          </p>
          <p class="mt-1 text-sm" i18n="@@booking.inProgressText">
            Les disponibilités et les prix ne sont pas encore calculés. Cette page affiche seulement
            les critères que vous avez saisis.
          </p>
        </div>
      </div>

      @if (summary(); as stay) {
        <dl
          class="mt-8 grid gap-4 rounded-xl bg-white p-6 shadow-card ring-1 ring-line sm:grid-cols-2"
        >
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
      } @else {
        <div class="mt-8 flex gap-3 rounded-lg border-l-4 border-danger bg-danger-pale p-4">
          <lucide-icon
            [img]="icons.alert"
            [size]="24"
            class="shrink-0 text-danger"
            aria-hidden="true"
          />
          <p i18n="@@booking.invalidSearch">
            Cette recherche est incomplète ou invalide. Relancez une recherche depuis l'accueil.
          </p>
        </div>
      }

      <a
        class="btn-secondary mt-8"
        routerLink="/"
        [fragment]="searchAnchor"
        i18n="@@booking.editSearch"
        >Modifier ma recherche</a
      >
    </div>
  `,
})
export class BookingInProgressPage {
  private readonly locale = injectLocale();
  private readonly queryParams = toSignal(inject(ActivatedRoute).queryParamMap, {
    requireSync: true,
  });

  protected readonly icons = { construction: Construction, alert: CircleAlert };
  protected readonly searchAnchor = SEARCH_ANCHOR;

  protected readonly summary = computed(() => {
    const params = this.queryParams();
    const criteria = fromSearchQueryParams((name) => params.get(name));
    if (criteria === null) {
      return null;
    }
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
