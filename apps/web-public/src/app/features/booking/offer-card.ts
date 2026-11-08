import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Check, LucideAngularModule } from 'lucide-angular';
import type { Offer } from '../../core/booking/availability-result';
import type { CategoryView } from '../../core/data/catalog.service';
import { guestsUpToLabel } from '../../core/i18n/counts';
import { formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { BOOKING_PATH, CHOICE_PATH, ROOMS_PATH } from '../../core/navigation';
import { Photo } from '../../shared/ui/photo';
import { perNightCents, priceOf, RATE_PLANS, type RatePlan } from './booking-model';

/**
 * One category of the results (step R-2): photo, facts, the stock when low, and the two rates
 * side by side with their conditions. « Choisir » leads to the choice page.
 */
@Component({
  selector: 'rvp-offer-card',
  imports: [LucideAngularModule, RouterLink, Photo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="grid overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-line md:grid-cols-[18rem_minmax(0,1fr)]"
      [attr.aria-labelledby]="titleId()"
    >
      <rvp-photo
        class="aspect-[3/2] md:aspect-auto md:h-full"
        sizes="(min-width: 768px) 288px, 100vw"
        [alt]="photoAlt()"
        [photo]="category().photos[0] ?? null"
      />
      <div class="flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-1">
          <h2 class="font-display text-h3-m font-semibold sm:text-h3" [id]="titleId()">
            <a class="hover:underline" [routerLink]="detailsLink()">{{ category().name }}</a>
          </h2>
          <p class="text-sm text-muted">{{ facts() }}</p>
          @if (roomsLeftText(); as text) {
            <p class="mt-1 self-start rounded-full bg-clay-pale px-3 py-1 text-sm font-semibold">
              {{ text }}
            </p>
          }
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          @for (rate of rates(); track rate.plan) {
            <section class="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-line">
              <h3 class="flex flex-wrap items-center gap-2 font-semibold">
                {{ rate.name }}
                @if (rate.badge; as badge) {
                  <span class="rounded-full bg-riad px-2 py-0.5 text-xs text-white">{{
                    badge
                  }}</span>
                }
              </h3>
              <ul class="flex flex-col gap-1 text-sm">
                @for (condition of rate.conditions; track $index) {
                  <li class="flex items-start gap-2">
                    <lucide-icon
                      class="mt-0.5 shrink-0 text-riad"
                      aria-hidden="true"
                      [img]="icons.check"
                      [size]="16"
                    />
                    {{ condition }}
                  </li>
                }
              </ul>
              <p class="mt-auto">
                <span class="text-2xl font-semibold tabular-nums">{{ rate.total }}</span>
                <span class="block text-sm text-muted">{{ rate.perNight }}</span>
              </p>
              <a
                class="btn-primary-compact"
                [routerLink]="choiceLink"
                [queryParams]="rate.queryParams"
              >
                <span i18n="@@offer.choose">Choisir</span>
                <span class="sr-only">{{ ' – ' + category().name + ', ' + rate.name }}</span>
              </a>
            </section>
          }
        </div>

        @if (offer().touristTaxCents > 0) {
          <p class="text-sm text-muted">{{ taxText() }}</p>
        }
      </div>
    </article>
  `,
})
export class OfferCard {
  readonly offer = input.required<Offer>();
  readonly category = input.required<CategoryView>();
  readonly nights = input.required<number>();
  readonly roomCount = input.required<number>();
  /** End of the free cancellation, already written for the visitor; null if unknown. */
  readonly deadline = input<string | null>(null);
  readonly discountPercent = input.required<number>();
  /** The search, as in the address, to carry on to the choice page. */
  readonly searchParams = input.required<Record<string, string>>();

  private readonly locale = injectLocale();
  protected readonly icons = { check: Check };
  protected readonly choiceLink = ['/', BOOKING_PATH, CHOICE_PATH];

  protected readonly titleId = computed(() => `offer-${this.offer().code}`);
  protected readonly detailsLink = computed(() => ['/', ROOMS_PATH, this.category().code]);

  protected readonly photoAlt = computed(
    () => $localize`:@@room.photoAlt:Photo de la catégorie ${this.category().name}:name:`,
  );

  protected readonly facts = computed(() => {
    const category = this.category();
    return `${guestsUpToLabel(category.maxOccupancy)} · ${category.areaSqm} m² · ${category.beds}`;
  });

  protected readonly roomsLeftText = computed(() => {
    const left = this.offer().roomsLeft;
    if (left === null) {
      return null;
    }
    return left === 1
      ? $localize`:@@offer.roomsLeft.one:Plus qu'une chambre`
      : $localize`:@@offer.roomsLeft.other:Plus que ${left}:count: chambres`;
  });

  protected readonly taxText = computed(
    () =>
      $localize`:@@offer.touristTax:+ taxe de séjour : ${formatPrice(this.offer().touristTaxCents, this.locale)}:amount:`,
  );

  private conditionsOf(plan: RatePlan): string[] {
    if (plan === 'non-refundable') {
      return [
        $localize`:@@offer.nonRefundable.paid:Payé à la réservation`,
        $localize`:@@offer.nonRefundable.final:Ni modifiable ni remboursable`,
      ];
    }
    const deadline = this.deadline();
    return [
      deadline === null
        ? $localize`:@@offer.flexible.cancel:Annulation gratuite`
        : $localize`:@@offer.flexible.cancelUntil:Annulation gratuite jusqu'au ${deadline}:date:`,
      $localize`:@@offer.flexible.guarantee:Rien à payer maintenant : carte demandée en garantie`,
    ];
  }

  private perNightText(totalCents: number): string {
    const price = formatPrice(perNightCents(totalCents, this.nights()), this.locale);
    const rooms = this.roomCount();
    return rooms === 1
      ? $localize`:@@offer.perNight:soit ${price}:price: par nuit`
      : $localize`:@@offer.perNightRooms:soit ${price}:price: par nuit pour ${rooms}:rooms: chambres`;
  }

  protected readonly rates = computed(() =>
    RATE_PLANS.map((plan) => {
      const totalCents = priceOf(this.offer(), plan);
      return {
        plan,
        name:
          plan === 'flexible'
            ? $localize`:@@offer.flexible.name:Tarif flexible`
            : $localize`:@@offer.nonRefundable.name:Non remboursable`,
        badge:
          plan === 'non-refundable' && this.discountPercent() > 0
            ? `−${this.discountPercent()} %`
            : null,
        conditions: this.conditionsOf(plan),
        total: formatPrice(totalCents, this.locale),
        perNight: this.perNightText(totalCents),
        queryParams: { ...this.searchParams(), category: this.offer().code, rate: plan },
      };
    }),
  );
}
