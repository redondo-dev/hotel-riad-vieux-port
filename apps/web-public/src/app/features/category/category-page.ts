import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AmenityCode } from '@riad/shared';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Images,
  LucideAngularModule,
  type LucideIconData,
  X,
} from 'lucide-angular';
import { CatalogService } from '../../core/data/catalog.service';
import { guestsUpToLabel } from '../../core/i18n/counts';
import { formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { SEARCH_ANCHOR } from '../../core/navigation';
import { AMENITY_ICONS } from '../../shared/ui/amenity-icons';
import { Photo } from '../../shared/ui/photo';

/** Photos shown beside the main one; the others are in the full-screen gallery. */
const THUMBNAILS = 2;

/**
 * Page of a room category (`/fr/chambres/<code>`): photos, description, every equipment and
 * the « from » price. A click on a photo opens the full-screen gallery: arrows, keyboard
 * (← → to change, Échap to close), « 2 / 5 ». Without photo, the decorated placeholder stays.
 * Booking online comes with the payment module: until then, the button leads to the search.
 */
@Component({
  selector: 'rvp-category-page',
  imports: [LucideAngularModule, RouterLink, Photo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (category(); as room) {
      <div class="container-page py-8 sm:py-12">
        <a class="btn-quiet -ml-3" routerLink="/" fragment="home-rooms-title">
          <lucide-icon [img]="icons.back" [size]="18" aria-hidden="true" />
          <span i18n="@@category.back">Toutes nos chambres</span>
        </a>

        <h1 class="mt-4 font-display text-h1-m font-semibold sm:text-h1">{{ room.name }}</h1>
        <p class="mt-2 text-muted">{{ facts() }}</p>

        @let photos = room.photos;
        @if (photos.length > 0) {
          <div class="mt-6 grid gap-2 sm:h-[30rem] sm:grid-cols-4 sm:grid-rows-2">
            @for (photo of photos.slice(0, thumbnails + 1); track $index; let first = $first) {
              <button
                type="button"
                class="group relative overflow-hidden rounded-xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-port"
                [class]="
                  first
                    ? 'aspect-[3/2] sm:col-span-3 sm:row-span-2 sm:aspect-auto'
                    : 'hidden sm:block'
                "
                (click)="open($index)"
              >
                <rvp-photo
                  class="size-full transition-transform duration-300 group-hover:scale-[1.02]"
                  [alt]="room.name"
                  [photo]="photo"
                  [sizes]="first ? '(min-width: 640px) 75vw, 100vw' : '25vw'"
                  [eager]="first"
                />
                <span class="sr-only">{{ enlargeLabel($index, photos.length) }}</span>
              </button>
            }
          </div>
          @if (photos.length > 1) {
            <button type="button" class="btn-secondary mt-3" (click)="open(0)">
              <lucide-icon [img]="icons.gallery" [size]="18" aria-hidden="true" />
              {{ showAllLabel(photos.length) }}
            </button>
          }
        } @else {
          <rvp-photo
            class="mt-6 aspect-[3/2] rounded-xl sm:aspect-[21/9]"
            [alt]="placeholderAlt()"
          />
        }

        <div class="mt-10 grid gap-10 lg:grid-cols-3">
          <div class="flex flex-col gap-8 lg:col-span-2">
            <section aria-labelledby="category-about">
              <h2 id="category-about" class="section-title" i18n="@@category.about">
                La chambre
              </h2>
              <p class="mt-4 whitespace-pre-line">{{ room.description }}</p>
              <p class="mt-4">
                <span class="font-semibold" i18n="@@category.beds">Lits :</span> {{ room.beds }}
              </p>
            </section>

            @if (room.amenities.length > 0) {
              <section aria-labelledby="category-amenities">
                <h2 id="category-amenities" class="section-title" i18n="@@category.amenities">
                  Équipements
                </h2>
                <ul class="mt-4 grid gap-3 sm:grid-cols-2">
                  @for (amenity of room.amenities; track amenity.code) {
                    <li class="flex items-center gap-3">
                      <lucide-icon
                        class="text-riad"
                        aria-hidden="true"
                        [img]="amenityIcon(amenity.code)"
                        [size]="20"
                      />
                      {{ amenity.label }}
                    </li>
                  }
                </ul>
              </section>
            }
          </div>

          <aside
            class="h-fit rounded-xl bg-white p-6 shadow-card ring-1 ring-line lg:sticky lg:top-24"
            aria-labelledby="category-price"
          >
            <h2 id="category-price" class="sr-only" i18n="@@category.price">Prix</h2>
            <p class="flex flex-wrap items-baseline gap-x-1.5">
              <span class="text-muted" i18n="@@room.from">À partir de</span>
              <span class="text-2xl font-semibold tabular-nums">{{ price() }}</span>
              <span class="text-muted" i18n="@@room.perNight">la nuit</span>
            </p>
            <p class="mt-2 text-xs text-muted" i18n="@@room.priceNote">
              Prix indicatif : tarif non remboursable, basse saison, hors taxe de séjour.
            </p>
            <a class="btn-primary mt-5 w-full" routerLink="/" [fragment]="searchAnchor">
              <span i18n="@@room.checkAvailability">Voir les disponibilités</span>
            </a>
          </aside>
        </div>
      </div>

      <dialog
        #viewer
        class="m-0 h-dvh max-h-none w-screen max-w-none bg-ink p-0 text-white backdrop:bg-ink/90"
        [attr.aria-label]="galleryLabel"
        (keydown)="onKey($event, room.photos.length)"
        (close)="closed()"
      >
        @if (room.photos[current()]; as photo) {
          <div class="flex h-full flex-col">
            <div class="flex items-center justify-between gap-4 p-3 sm:p-4">
              <p class="tabular-nums" aria-live="polite">
                {{ current() + 1 }} / {{ room.photos.length }}
              </p>
              <button
                type="button"
                class="inline-flex size-11 items-center justify-center rounded-lg hover:bg-white/10"
                (click)="viewer.close()"
              >
                <lucide-icon [img]="icons.close" [size]="24" aria-hidden="true" />
                <span class="sr-only" i18n="@@common.close">Fermer</span>
              </button>
            </div>
            <div class="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
              <img
                class="max-h-full max-w-full object-contain"
                sizes="100vw"
                [src]="photo.src"
                [attr.srcset]="photo.srcset"
                [attr.width]="photo.width"
                [attr.height]="photo.height"
                [alt]="photo.alt"
              />
              @if (room.photos.length > 1) {
                <button
                  type="button"
                  class="absolute left-2 inline-flex size-12 items-center justify-center rounded-full bg-ink/60 hover:bg-ink/80 sm:left-4"
                  (click)="step(-1, room.photos.length)"
                >
                  <lucide-icon [img]="icons.previous" [size]="28" aria-hidden="true" />
                  <span class="sr-only" i18n="@@category.gallery.previous">Photo précédente</span>
                </button>
                <button
                  type="button"
                  class="absolute right-2 inline-flex size-12 items-center justify-center rounded-full bg-ink/60 hover:bg-ink/80 sm:right-4"
                  (click)="step(1, room.photos.length)"
                >
                  <lucide-icon [img]="icons.next" [size]="28" aria-hidden="true" />
                  <span class="sr-only" i18n="@@category.gallery.next">Photo suivante</span>
                </button>
              }
            </div>
            <p class="p-4 text-center text-sm text-white/80">{{ photo.alt }}</p>
          </div>
        }
      </dialog>
    }
  `,
})
export class CategoryPage {
  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();
  private readonly viewer = viewChild<ElementRef<HTMLDialogElement>>('viewer');

  /** From the address /fr/chambres/:code (the route only matches a known code). */
  readonly code = input.required<string>();

  protected readonly thumbnails = THUMBNAILS;
  protected readonly searchAnchor = SEARCH_ANCHOR;
  protected readonly galleryLabel = $localize`:@@category.gallery.label:Photos de la chambre`;
  protected readonly icons = {
    back: ArrowLeft,
    gallery: Images,
    close: X,
    previous: ChevronLeft,
    next: ChevronRight,
  };

  protected readonly category = computed(() =>
    this.catalog.categories.find((category) => category.code === this.code()),
  );

  /** Index of the photo shown in the full-screen gallery. */
  protected readonly current = signal(0);

  protected readonly facts = computed(() => {
    const category = this.category();
    if (category === undefined) {
      return '';
    }
    return `${guestsUpToLabel(category.maxOccupancy)} · ${category.areaSqm} m² · ${category.beds}`;
  });

  protected readonly price = computed(() =>
    formatPrice(this.category()?.fromPriceCents ?? 0, this.locale),
  );

  protected readonly placeholderAlt = computed(
    () => $localize`:@@room.photoAlt:Photo de la catégorie ${this.category()?.name ?? ''}:name:`,
  );

  protected amenityIcon(code: AmenityCode): LucideIconData {
    return AMENITY_ICONS[code];
  }

  protected enlargeLabel(index: number, total: number): string {
    return $localize`:@@category.gallery.enlarge:Agrandir la photo ${index + 1}:number: sur ${total}:total:`;
  }

  protected showAllLabel(total: number): string {
    return $localize`:@@category.gallery.showAll:Voir les ${total}:total: photos`;
  }

  protected open(index: number): void {
    this.current.set(index);
    this.viewer()?.nativeElement.showModal();
  }

  /** Previous (-1) or next (1); from the last photo, back to the first. */
  protected step(offset: -1 | 1, total: number): void {
    this.current.update((index) => (index + offset + total) % total);
  }

  /** Échap is handled by the dialog itself. */
  protected onKey(event: KeyboardEvent, total: number): void {
    if (total < 2) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.step(-1, total);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(1, total);
    }
  }

  protected closed(): void {
    this.current.set(0);
  }
}
