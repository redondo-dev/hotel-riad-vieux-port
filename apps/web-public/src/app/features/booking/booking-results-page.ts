import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSearchQueryParams } from '@riad/shared';
import { CatalogService } from '../../core/data/catalog.service';
import { formatInstant } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { SEARCH_ANCHOR } from '../../core/navigation';
import { Notice } from '../../shared/ui/notice';
import { StaySearch } from '../../shared/ui/stay-search/stay-search';
import type { SearchPageData } from './booking-route';
import { OfferCard } from './offer-card';
import { SearchSummary } from './search-summary';

/**
 * Results of a stay search (step R-2, UI/UX specification 4.B): the search in words, the form
 * to change it, then one card per category able to take the whole search, in the display order
 * chosen by the management. Every case has its message: incomplete search, rule broken,
 * nothing available, too many searches, search impossible.
 */
@Component({
  selector: 'rvp-booking-results-page',
  imports: [RouterLink, Notice, OfferCard, SearchSummary, StaySearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let data = search();
    <div class="container-page py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@booking.title">
        Votre recherche
      </h1>

      @if (data.criteria; as criteria) {
        <div class="mt-6">
          <rvp-search-summary [criteria]="criteria" />
        </div>
        <details class="mt-4 rounded-xl bg-stone/60 p-4">
          <summary class="cursor-pointer font-semibold text-port" i18n="@@booking.editSearch">
            Modifier ma recherche
          </summary>
          <div class="mt-4">
            <rvp-stay-search idPrefix="results-search" [initial]="criteria" />
          </div>
        </details>
      }

      <div class="mt-8 flex flex-col gap-6">
        @if (data.criteria === null) {
          <rvp-notice>
            <p i18n="@@booking.invalidSearch">
              Cette recherche est incomplète ou invalide. Relancez une recherche depuis l'accueil.
            </p>
            <a
              class="btn-secondary mt-4"
              routerLink="/"
              [fragment]="searchAnchor"
              i18n="@@booking.newSearch"
              >Nouvelle recherche</a
            >
          </rvp-notice>
        } @else if (data.problems.length > 0) {
          <rvp-notice>
            <ul class="flex flex-col gap-1">
              @for (problem of data.problems; track $index) {
                <li>{{ problem }}</li>
              }
            </ul>
          </rvp-notice>
        } @else if (data.result; as result) {
          @switch (result.kind) {
            @case ('found') {
              @for (card of cards(); track card.offer.code) {
                <rvp-offer-card
                  [offer]="card.offer"
                  [category]="card.category"
                  [nights]="nights()"
                  [roomCount]="roomCount()"
                  [deadline]="deadline()"
                  [discountPercent]="discountPercent"
                  [searchParams]="searchParams()"
                />
              } @empty {
                <rvp-notice tone="info">
                  <p class="font-semibold" i18n="@@booking.noneTitle">
                    Aucune chambre disponible pour ces dates
                  </p>
                  <p class="mt-1">{{ texts.none }}</p>
                </rvp-notice>
              }
            }
            @case ('busy') {
              <rvp-notice>
                <p i18n="@@booking.busy">
                  Trop de recherches en peu de temps. Réessayez dans une minute.
                </p>
              </rvp-notice>
            }
            @case ('refused') {
              <rvp-notice>
                <p>{{ texts.refused }}</p>
              </rvp-notice>
            }
            @default {
              <rvp-notice>
                <p>{{ texts.unavailable }}</p>
              </rvp-notice>
            }
          }
        }
      </div>
    </div>
  `,
})
export class BookingResultsPage {
  /** Read by searchResolver before the page is shown. */
  readonly search = input.required<SearchPageData>();

  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();

  protected readonly searchAnchor = SEARCH_ANCHOR;
  private readonly phone = this.catalog.hotel.phone.display;
  protected readonly texts = {
    none: $localize`:@@booking.noneText:Essayez d'autres dates ou moins de chambres, ou appelez la réception au ${this.phone}:phone: : nous chercherons une solution avec vous.`,
    refused: $localize`:@@booking.refused:Cette recherche n'est pas possible en ligne. Modifiez vos dates ou appelez la réception au ${this.phone}:phone:.`,
    unavailable: $localize`:@@booking.unavailable:Recherche momentanément impossible. Réessayez dans quelques instants ou appelez la réception au ${this.phone}:phone:.`,
  };
  protected readonly discountPercent = this.catalog.bookingRules.nonRefundableDiscountPercent;

  /** Offers with their category; an offer unknown to the catalogue of the site is left out. */
  protected readonly cards = computed(() => {
    const result = this.search().result;
    if (result?.kind !== 'found') {
      return [];
    }
    return result.availability.offers.flatMap((offer) => {
      const category = this.catalog.categories.find((item) => item.code === offer.code);
      return category === undefined ? [] : [{ offer, category }];
    });
  });

  protected readonly roomCount = computed(() => this.search().criteria?.rooms.length ?? 1);

  protected readonly nights = computed(() => {
    const result = this.search().result;
    return result?.kind === 'found' ? result.availability.nights : 1;
  });

  protected readonly searchParams = computed(() => {
    const criteria = this.search().criteria;
    return criteria === null ? {} : toSearchQueryParams(criteria);
  });

  /** « 10 mai à 15:00 », at the hotel's time. */
  protected readonly deadline = computed(() => {
    const result = this.search().result;
    const instant = result?.kind === 'found' ? result.availability.freeCancellationUntil : null;
    if (instant === null) {
      return null;
    }
    return formatInstant(instant, this.locale, this.catalog.hotel.timeZone, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  });
}
