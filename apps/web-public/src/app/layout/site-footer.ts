import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, Mail, MapPin, Phone } from 'lucide-angular';
import { CatalogService } from '../core/data/catalog.service';
import { formatTime } from '../core/i18n/format';
import { injectLocale, OTHER_LANGUAGE } from '../core/i18n/locale';
import { Logo } from '../shared/ui/logo';
import { ZelligeStar } from '../shared/ui/zellige-star';

/**
 * Legal links (legal notice, terms of sale, privacy) will be added with their pages,
 * as for the navigation: no link to a page that does not exist yet.
 */
@Component({
  selector: 'rvp-site-footer',
  imports: [LucideAngularModule, Logo, ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="on-dark relative mt-24 overflow-hidden bg-port-dark text-white">
      <rvp-zellige-star class="absolute -top-16 -right-16 size-72 text-white/[0.06]" />
      <div class="container-page relative grid gap-10 py-14 md:grid-cols-3">
        <div class="flex flex-col gap-4">
          <rvp-logo tone="on-dark" />
          <p class="flex items-start gap-2 text-white/85">
            <lucide-icon
              [img]="icons.mapPin"
              [size]="20"
              class="mt-1 shrink-0"
              aria-hidden="true"
            />
            <span>{{ address }}</span>
          </p>
        </div>

        <div class="flex flex-col gap-3">
          <h2 class="font-semibold" i18n="@@footer.contactTitle">Nous contacter</h2>
          <a
            class="inline-flex min-h-11 items-center gap-2 text-white/85 hover:text-white hover:underline"
            [href]="'tel:' + hotel.phone.international"
          >
            <lucide-icon [img]="icons.phone" [size]="18" aria-hidden="true" />
            <span>{{ hotel.phone.display }}</span>
          </a>
          <a
            class="inline-flex min-h-11 items-center gap-2 text-white/85 hover:text-white hover:underline"
            [href]="'mailto:' + hotel.email"
          >
            <lucide-icon [img]="icons.mail" [size]="18" aria-hidden="true" />
            <span>{{ hotel.email }}</span>
          </a>
        </div>

        <div class="flex flex-col gap-3">
          <h2 class="font-semibold" i18n="@@footer.hoursTitle">Horaires</h2>
          <ul class="flex flex-col gap-2 text-white/85">
            <li>{{ checkInText }}</li>
            <li>{{ checkOutText }}</li>
            <li i18n="@@footer.reception">Réception ouverte 24 h/24</li>
          </ul>
        </div>
      </div>

      <div class="relative border-t border-white/15">
        <div
          class="container-page flex flex-col gap-2 py-5 text-sm text-white/75 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="flex flex-col gap-1">
            <p i18n="@@footer.demoNotice">
              Hôtel fictif : site de démonstration réalisé pour un portfolio.
            </p>
            <p>
              <span i18n="@@footer.photosBy">Photos :</span>
              <a
                class="font-medium text-white hover:underline"
                href="https://unsplash.com/?utm_source=hotel_riad_vieux_port&amp;utm_medium=referral"
                rel="noopener"
                >Unsplash</a
              >
            </p>
          </div>
          <a
            class="inline-flex min-h-11 items-center font-medium text-white hover:underline"
            [href]="otherLanguage.href"
            [attr.hreflang]="otherLanguage.code"
            [attr.lang]="otherLanguage.code"
            >{{ otherLanguage.label }}</a
          >
        </div>
      </div>
    </footer>
  `,
})
export class SiteFooter {
  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();

  protected readonly hotel = this.catalog.hotel;
  protected readonly address = this.catalog.address;
  protected readonly otherLanguage = OTHER_LANGUAGE[this.locale];
  protected readonly icons = { phone: Phone, mail: Mail, mapPin: MapPin };

  protected readonly checkInText = $localize`:@@footer.checkIn:Arrivée à partir de ${formatTime(this.hotel.checkInFrom, this.locale)}:time:`;
  protected readonly checkOutText = $localize`:@@footer.checkOut:Départ avant ${formatTime(this.hotel.checkOutBefore, this.locale)}:time:`;
}
