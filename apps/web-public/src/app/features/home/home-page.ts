import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { HotelServiceCode } from '@riad/shared';
import {
  AirVent,
  Baby,
  CalendarCheck,
  Clock,
  ConciergeBell,
  Coffee,
  LucideAngularModule,
  ShieldCheck,
  Star,
  UtensilsCrossed,
  Wifi,
  type LucideIconData,
} from 'lucide-angular';
import { CatalogService } from '../../core/data/catalog.service';
import { SEARCH_ANCHOR } from '../../core/navigation';
import { Photo } from '../../shared/ui/photo';
import { RoomCard } from '../../shared/ui/room-card';
import { StaySearch } from '../../shared/ui/stay-search/stay-search';

const SERVICE_ICONS: Record<HotelServiceCode, LucideIconData> = {
  breakfast: Coffee,
  'restaurant-bar': UtensilsCrossed,
  'reception-24h': ConciergeBell,
  'baby-cot': Baby,
  wifi: Wifi,
  'air-conditioning': AirVent,
};

/**
 * Home page (UI/UX specification 4.A). Links to pages that do not exist yet
 * ("Discover the hotel", "Neighbourhood and access", "All rooms") will be added with
 * those pages; every remaining button leads somewhere real.
 */
@Component({
  selector: 'rvp-home-page',
  imports: [LucideAngularModule, RouterLink, Photo, RoomCard, StaySearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.html',
})
export class HomePage {
  private readonly catalog = inject(CatalogService);

  protected readonly searchAnchor = SEARCH_ANCHOR;
  protected readonly categories = this.catalog.categories;
  protected readonly totalRooms = this.catalog.totalRooms;
  protected readonly services = this.catalog.services.map((service) => ({
    ...service,
    icon: SERVICE_ICONS[service.code],
  }));
  protected readonly reviews = this.catalog.reviews;
  protected readonly icons = {
    reception: Clock,
    cancellation: CalendarCheck,
    payment: ShieldCheck,
    star: Star,
  };
  protected readonly stars = [1, 2, 3, 4, 5];

  protected readonly heroAlt = $localize`:@@home.hero.photoAlt:Façade de l'hôtel face aux bateaux du Vieux-Port`;
  protected readonly aboutAlt = $localize`:@@home.about.photoAlt:Patio intérieur de l'hôtel, carreaux de zellige et plantes`;
  protected readonly neighbourhoodAlt = $localize`:@@home.neighbourhood.photoAlt:Le Vieux-Port de Marseille et Notre-Dame-de-la-Garde au coucher du soleil`;
  protected readonly roomsListLabel = $localize`:@@home.rooms.listLabel:Nos catégories de chambres, faire défiler horizontalement`;
  protected readonly aboutText = $localize`:@@home.about.text:Un hôtel indépendant de ${this.totalRooms}:rooms: chambres, entre la lumière de Marseille et l'esprit des riads : un patio au calme, une équipe à l'écoute et le Vieux-Port au bout de la rue.`;

  /**
   * The list scrolls horizontally below 1024 px only. It is a keyboard stop only while it
   * scrolls, so that keyboard users can scroll it (audit QA-05). The server renders the phone
   * layout, where it scrolls.
   */
  protected readonly roomsScrollable = signal(true);
  private readonly roomsList = viewChild.required<ElementRef<HTMLElement>>('roomsList');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.roomsList().nativeElement;
      const observer = new ResizeObserver(() => {
        this.roomsScrollable.set(element.scrollWidth > element.clientWidth);
      });
      observer.observe(element);
      destroyRef.onDestroy(() => {
        observer.disconnect();
      });
    });
  }

  protected ratingLabel(rating: number): string {
    return $localize`:@@home.reviews.rating:Note : ${rating}:rating: sur 5`;
  }

  protected reviewStay(categoryName: string): string {
    return $localize`:@@home.reviews.stay:Séjour en ${categoryName}:category:`;
  }
}
