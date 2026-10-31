import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule, Menu, Phone, X } from 'lucide-angular';
import { CatalogService } from '../core/data/catalog.service';
import { injectLocale, OTHER_LANGUAGE } from '../core/i18n/locale';
import { PUBLIC_NAV, SEARCH_ANCHOR } from '../core/navigation';
import { Logo } from '../shared/ui/logo';

@Component({
  selector: 'rvp-site-header',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-40 border-b border-line bg-sand/95 backdrop-blur">
      <div class="container-page flex h-16 items-center gap-6 lg:h-20">
        <a
          routerLink="/"
          class="rounded-sm"
          i18n-aria-label="@@header.homeLink"
          aria-label="Hôtel Riad Vieux-Port, accueil"
        >
          <rvp-logo />
        </a>

        @if (navItems.length > 0) {
          <nav
            class="hidden lg:block"
            i18n-aria-label="@@header.mainNav"
            aria-label="Navigation principale"
          >
            <ul class="flex gap-6">
              @for (item of navItems; track item.path) {
                <li>
                  <a
                    class="font-medium text-ink underline-offset-8 hover:underline"
                    [routerLink]="['/', item.path]"
                    routerLinkActive="text-port underline"
                    ariaCurrentWhenActive="page"
                    >{{ item.label }}</a
                  >
                </li>
              }
            </ul>
          </nav>
        }

        <div class="ml-auto flex items-center gap-2 sm:gap-4">
          <a
            class="hidden items-center gap-2 text-sm font-medium text-port hover:underline md:inline-flex"
            [href]="'tel:' + hotel.phone.international"
          >
            <lucide-icon [img]="icons.phone" [size]="18" aria-hidden="true" />
            <span>{{ hotel.phone.display }}</span>
          </a>
          <a
            class="hidden text-sm font-medium text-port hover:underline sm:inline"
            [href]="otherLanguage.href"
            [attr.hreflang]="otherLanguage.code"
            [attr.lang]="otherLanguage.code"
            >{{ otherLanguage.label }}</a
          >
          <a
            class="btn-primary-compact"
            routerLink="/"
            [fragment]="searchAnchor"
            i18n="@@header.book"
            >Réserver</a
          >
          <button
            type="button"
            class="btn-icon lg:hidden"
            aria-haspopup="dialog"
            [attr.aria-expanded]="menuOpen()"
            i18n-aria-label="@@header.openMenu"
            aria-label="Ouvrir le menu"
            (click)="openMenu()"
          >
            <lucide-icon [img]="icons.menu" [size]="24" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>

    <dialog
      #menuDialog
      class="dialog-panel sm:w-[min(24rem,calc(100vw_-_2rem))]"
      aria-labelledby="mobile-menu-title"
      (close)="onMenuClosed()"
    >
      <div class="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="mobile-menu-title" class="sr-only" i18n="@@header.menuTitle">Menu</h2>
        <rvp-logo />
        <button
          type="button"
          class="btn-icon"
          i18n-aria-label="@@common.close"
          aria-label="Fermer"
          (click)="closeMenu()"
        >
          <lucide-icon [img]="icons.close" [size]="24" aria-hidden="true" />
        </button>
      </div>
      <nav
        class="flex flex-1 flex-col gap-2 overflow-y-auto px-5 py-6"
        i18n-aria-label="@@header.mainNav"
        aria-label="Navigation principale"
      >
        @for (item of navItems; track item.path) {
          <a
            class="flex min-h-12 items-center text-lg font-medium text-ink"
            [routerLink]="['/', item.path]"
            (click)="closeMenu()"
            >{{ item.label }}</a
          >
        }
        <a
          class="btn-primary mt-2"
          routerLink="/"
          [fragment]="searchAnchor"
          (click)="closeMenu()"
          i18n="@@header.book"
          >Réserver</a
        >
        <a
          class="mt-4 inline-flex min-h-12 items-center gap-3 font-medium text-port"
          [href]="'tel:' + hotel.phone.international"
        >
          <lucide-icon [img]="icons.phone" [size]="20" aria-hidden="true" />
          <span>{{ hotel.phone.display }}</span>
        </a>
        <a
          class="inline-flex min-h-12 items-center font-medium text-port"
          [href]="otherLanguage.href"
          [attr.hreflang]="otherLanguage.code"
          [attr.lang]="otherLanguage.code"
          >{{ otherLanguage.label }}</a
        >
      </nav>
    </dialog>
  `,
})
export class SiteHeader {
  protected readonly hotel = inject(CatalogService).hotel;
  protected readonly otherLanguage = OTHER_LANGUAGE[injectLocale()];
  protected readonly navItems = PUBLIC_NAV.filter((item) => item.available);
  protected readonly searchAnchor = SEARCH_ANCHOR;
  protected readonly icons = { menu: Menu, close: X, phone: Phone };
  protected readonly menuOpen = signal(false);

  private readonly menuDialog = viewChild.required<ElementRef<HTMLDialogElement>>('menuDialog');

  protected openMenu(): void {
    this.menuDialog().nativeElement.showModal();
    this.menuOpen.set(true);
  }

  protected closeMenu(): void {
    this.menuDialog().nativeElement.close();
  }

  protected onMenuClosed(): void {
    this.menuOpen.set(false);
  }
}
