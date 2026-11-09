import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSearchQueryParams } from '@riad/shared';
import { CatalogService } from '../../core/data/catalog.service';
import { formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { BOOKING_PATH } from '../../core/navigation';
import { Notice } from '../../shared/ui/notice';
import { choiceOf } from './booking-model';
import type { SearchPageData } from './booking-route';
import { SearchSummary } from './search-summary';

/**
 * TEMPORARY SCREEN (decision « 1a » of step R-2): the offer chosen on the results page, read
 * again (prices and stock may have changed), and a plain message that the guest's details and
 * the payment come next (step R-4). Nothing is held: no room is blocked here.
 */
@Component({
  selector: 'rvp-booking-choice-page',
  imports: [RouterLink, Notice, SearchSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let data = search();
    <div class="container-page max-w-3xl py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@choice.title">
        Votre choix
      </h1>

      @if (chosen(); as offer) {
        <div class="mt-6">
          <rvp-notice tone="info">
            <p class="font-semibold" i18n="@@choice.nextTitle">Étape suivante en préparation</p>
            <p class="mt-1" i18n="@@choice.nextText">
              La saisie de vos coordonnées et le paiement sécurisé arrivent bientôt. Rien n'est
              réservé pour l'instant.
            </p>
          </rvp-notice>
        </div>

        <section
          class="mt-6 flex flex-col gap-2 rounded-xl bg-white p-6 shadow-card ring-1 ring-line"
          aria-labelledby="choice-offer"
        >
          <h2 id="choice-offer" class="font-display text-h3-m font-semibold sm:text-h3">
            {{ offer.name }}
          </h2>
          <p class="font-semibold">{{ offer.rate }}</p>
          <p class="text-2xl font-semibold tabular-nums">{{ offer.total }}</p>
          @if (offer.tax; as tax) {
            <p class="text-sm text-muted">{{ tax }}</p>
          }
        </section>

        @if (data.criteria; as criteria) {
          <div class="mt-6">
            <rvp-search-summary [criteria]="criteria" />
          </div>
        }
      } @else {
        <div class="mt-6">
          <rvp-notice>
            <p i18n="@@choice.gone">
              Cette offre n'est plus disponible pour ces dates. Revenez aux résultats pour en
              choisir une autre.
            </p>
          </rvp-notice>
        </div>
      }

      <a
        class="btn-secondary mt-8"
        [routerLink]="resultsLink"
        [queryParams]="searchParams()"
        i18n="@@choice.back"
        >Revenir aux résultats</a
      >
    </div>
  `,
})
export class BookingChoicePage {
  /** Read by searchResolver before the page is shown. */
  readonly search = input.required<SearchPageData>();
  /** From the address: « …&category=double-standard&rate=flexible ». */
  readonly category = input<string>();
  readonly rate = input<string>();

  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();
  protected readonly resultsLink = ['/', BOOKING_PATH];

  protected readonly searchParams = computed(() => {
    const criteria = this.search().criteria;
    return criteria === null ? {} : toSearchQueryParams(criteria);
  });

  /** The offer in words, or null when it is no longer available. */
  protected readonly chosen = computed(() => {
    const result = this.search().result;
    if (result?.kind !== 'found') {
      return null;
    }
    const choice = choiceOf(result.availability, this.category(), this.rate());
    const category = this.catalog.categories.find((item) => item.code === choice?.offer.code);
    if (choice === null || category === undefined) {
      return null;
    }
    const taxCents = choice.offer.touristTaxCents;
    return {
      name: category.name,
      rate:
        choice.rate === 'flexible'
          ? $localize`:@@offer.flexible.name:Tarif flexible`
          : $localize`:@@offer.nonRefundable.name:Non remboursable`,
      total: formatPrice(choice.totalCents, this.locale),
      tax:
        taxCents > 0
          ? $localize`:@@offer.touristTax:+ taxe de séjour : ${formatPrice(taxCents, this.locale)}:amount:`
          : null,
    };
  });
}
