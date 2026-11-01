import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * Frame of the catalogue: four tabs (links, so that each one has its own address and the
 * browser's back button works), then the screen of the chosen tab.
 */
@Component({
  selector: 'adm-catalog-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Sections du catalogue" class="mb-5 border-b border-line">
      <ul class="-mb-px flex gap-1 overflow-x-auto">
        @for (tab of tabs; track tab.path) {
          <li>
            <a
              [routerLink]="tab.path"
              routerLinkActive="border-port font-semibold text-port"
              ariaCurrentWhenActive="page"
              class="inline-flex h-11 items-center border-b-2 border-transparent px-4 whitespace-nowrap text-muted hover:text-ink"
            >
              {{ tab.label }}
            </a>
          </li>
        }
      </ul>
    </nav>
    <router-outlet />
  `,
})
export class CatalogLayout {
  protected readonly tabs = [
    { path: '/catalogue/categories', label: 'Catégories' },
    { path: '/catalogue/chambres', label: 'Chambres' },
    { path: '/catalogue/tarifs', label: 'Tarifs' },
    { path: '/catalogue/services', label: 'Services' },
  ] as const;
}
