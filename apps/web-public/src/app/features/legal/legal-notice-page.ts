import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PHOTO_CREDITS } from '../../core/data/photo-credits';
import { CatalogService } from '../../core/data/catalog.service';
import { Notice } from '../../shared/ui/notice';

/**
 * Legal notice (step L-1): publisher, author and publishing director, contact, host, photos.
 * The hotel is fictional and says so; the host is to be given when the site goes online.
 */
@Component({
  selector: 'rvp-legal-notice-page',
  imports: [Notice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="container-page max-w-3xl py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@legal.title">
        Mentions légales
      </h1>
      <div class="mt-6">
        <rvp-notice tone="info">
          <p i18n="@@legal.fictional">
            Hôtel fictif : ces mentions décrivent un site de démonstration.
          </p>
        </rvp-notice>
      </div>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="legal-publisher">
        <h2 id="legal-publisher" class="section-title" i18n="@@legal.publisherTitle">Éditeur</h2>
        <p i18n="@@legal.publisher">
          L'Hôtel Riad Vieux-Port est un établissement fictif : ce site est un projet de
          démonstration réalisé pour un portfolio. Aucune réservation n'y est réelle et aucun
          paiement réel n'y est encaissé.
        </p>
        <p>{{ address }}</p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="legal-author">
        <h2 id="legal-author" class="section-title" i18n="@@legal.authorTitle">
          Conception et direction de la publication
        </h2>
        <p i18n="@@legal.author">
          Site conçu et réalisé par Riad Reda Fethi (redondo-dev), également directeur de la
          publication.
        </p>
        <p>
          <a class="text-port underline" href="https://github.com/redondo-dev" rel="noopener"
            >github.com/redondo-dev</a
          >
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="legal-contact">
        <h2 id="legal-contact" class="section-title" i18n="@@legal.contactTitle">Contact</h2>
        <p>
          <a class="text-port underline" [href]="'mailto:' + hotel.email">{{ hotel.email }}</a>
        </p>
        <p>
          <a class="text-port underline" [href]="'tel:' + hotel.phone.international">{{
            hotel.phone.display
          }}</a>
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="legal-hosting">
        <h2 id="legal-hosting" class="section-title" i18n="@@legal.hostingTitle">Hébergement</h2>
        <p i18n="@@legal.hosting">
          Hébergeur : à préciser lors de la mise en ligne du site (nom, adresse et téléphone de
          l'hébergeur).
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="legal-photos">
        <h2 id="legal-photos" class="section-title" i18n="@@legal.photosTitle">Photos</h2>
        <p i18n="@@legal.photos">
          Les photos proviennent d'Unsplash et sont utilisées selon la licence Unsplash.
        </p>
        @if (credits.length > 0) {
          <ul class="flex list-disc flex-col gap-1 pl-6">
            @for (credit of credits; track credit.photo) {
              <li>
                <a class="text-port underline" [href]="credit.url" rel="noopener">{{
                  credit.photographer
                }}</a>
              </li>
            }
          </ul>
        }
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="legal-ip">
        <h2 id="legal-ip" class="section-title" i18n="@@legal.ipTitle">Propriété intellectuelle</h2>
        <p i18n="@@legal.ip">
          Les textes, le code et la mise en page de ce site sont l'œuvre de son auteur. Les photos
          restent la propriété de leurs photographes.
        </p>
      </section>
    </article>
  `,
})
export class LegalNoticePage {
  private readonly catalog = inject(CatalogService);

  protected readonly hotel = this.catalog.hotel;
  protected readonly address = this.catalog.address;
  protected readonly credits = PHOTO_CREDITS;
}
