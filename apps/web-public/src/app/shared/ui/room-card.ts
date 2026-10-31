import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AmenityCode } from '@riad/shared';
import {
  AirVent,
  Anchor,
  Bath,
  LockKeyhole,
  LucideAngularModule,
  ShowerHead,
  Sofa,
  Tv,
  Wifi,
  Wind,
  type LucideIconData,
} from 'lucide-angular';
import type { CategoryView } from '../../core/data/catalog.service';
import { guestsUpToLabel } from '../../core/i18n/counts';
import { formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { SEARCH_ANCHOR } from '../../core/navigation';
import { Photo } from './photo';

const AMENITY_ICONS: Record<AmenityCode, LucideIconData> = {
  wifi: Wifi,
  'air-conditioning': AirVent,
  tv: Tv,
  safe: LockKeyhole,
  'hair-dryer': Wind,
  shower: ShowerHead,
  bathtub: Bath,
  'sitting-area': Sofa,
  'port-view': Anchor,
};

/** Signature amenities shown first; the full list will be on the category detail page. */
const HIGHLIGHTED: AmenityCode[] = [
  'port-view',
  'sitting-area',
  'bathtub',
  'air-conditioning',
  'wifi',
  'shower',
];

/**
 * Room category card (UI/UX specification 4.C). The price is an indication: lowest rate
 * (non-refundable, low season), tourist tax excluded, as stated under the price.
 * The "Details" button will appear with the category detail page.
 */
@Component({
  selector: 'rvp-room-card',
  imports: [LucideAngularModule, RouterLink, Photo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <article
      class="flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-line"
    >
      <rvp-photo class="aspect-[3/2]" [alt]="photoAlt()" />
      <div class="flex flex-1 flex-col gap-3 p-5">
        <h3 class="font-display text-h3-m font-semibold sm:text-h3">{{ category().name }}</h3>
        <p class="text-sm text-muted">{{ facts() }}</p>
        <ul class="flex flex-wrap gap-x-4 gap-y-2 text-sm" [attr.aria-label]="amenitiesLabel">
          @for (amenity of highlightedAmenities(); track amenity.code) {
            <li class="inline-flex items-center gap-1.5">
              <lucide-icon [img]="amenity.icon" [size]="16" class="text-riad" aria-hidden="true" />
              <span>{{ amenity.label }}</span>
            </li>
          }
        </ul>
        <p class="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-2">
          <span class="text-sm text-muted" i18n="@@room.from">À partir de</span>
          <span class="text-xl font-semibold tabular-nums">{{ price() }}</span>
          <span class="text-sm text-muted" i18n="@@room.perNight">la nuit</span>
        </p>
        <p class="text-xs text-muted" i18n="@@room.priceNote">
          Prix indicatif : tarif non remboursable, basse saison, hors taxe de séjour.
        </p>
        <a class="btn-secondary mt-2" routerLink="/" [fragment]="searchAnchor">
          <span i18n="@@room.checkAvailability">Voir les disponibilités</span>
          <span class="sr-only">{{ ' – ' + category().name }}</span>
        </a>
      </div>
    </article>
  `,
})
export class RoomCard {
  readonly category = input.required<CategoryView>();

  private readonly locale = injectLocale();
  protected readonly searchAnchor = SEARCH_ANCHOR;
  protected readonly amenitiesLabel = $localize`:@@room.amenities:Équipements`;

  protected readonly facts = computed(() => {
    const category = this.category();
    return `${guestsUpToLabel(category.maxOccupancy)} · ${category.areaSqm} m² · ${category.beds}`;
  });

  protected readonly highlightedAmenities = computed(() =>
    this.category()
      .amenities.filter((amenity) => HIGHLIGHTED.includes(amenity.code))
      .sort((a, b) => HIGHLIGHTED.indexOf(a.code) - HIGHLIGHTED.indexOf(b.code))
      .slice(0, 3)
      .map((amenity) => ({ ...amenity, icon: AMENITY_ICONS[amenity.code] })),
  );

  protected readonly price = computed(() =>
    formatPrice(this.category().fromPriceCents, this.locale),
  );

  protected readonly photoAlt = computed(
    () => $localize`:@@room.photoAlt:Photo de la catégorie ${this.category().name}:name:`,
  );
}
