import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CatalogService } from '../../core/data/catalog.service';
import { formatTime } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { Notice } from '../../shared/ui/notice';

/**
 * Conditions of sale and cancellation (decision « 1 » of step R-4): the rules the booking
 * applies, in plain words, with the values set by the management (hours, discount). The hotel
 * is fictional: for a real hotel, this text must be reviewed by a lawyer.
 */
@Component({
  selector: 'rvp-terms-page',
  imports: [Notice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="container-page max-w-3xl py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@terms.title">
        Conditions de vente et d'annulation
      </h1>
      <div class="mt-6">
        <rvp-notice tone="info">
          <p i18n="@@terms.fictional">
            Hôtel fictif : ces conditions illustrent un site de démonstration et n'engagent
            personne.
          </p>
        </rvp-notice>
      </div>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="terms-rates">
        <h2 id="terms-rates" class="section-title" i18n="@@terms.ratesTitle">Les deux tarifs</h2>
        <p>{{ texts.flexible }}</p>
        <p>{{ texts.nonRefundable }}</p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="terms-cancel">
        <h2 id="terms-cancel" class="section-title" i18n="@@terms.cancelTitle">
          Annulation et non-présentation
        </h2>
        <p>{{ texts.cancel }}</p>
        <p i18n="@@terms.noShow">
          En cas de non-présentation, la première nuit est due au tarif flexible ; au tarif non
          remboursable, le séjour payé reste acquis à l'hôtel.
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="terms-payment">
        <h2 id="terms-payment" class="section-title" i18n="@@terms.paymentTitle">
          Paiement et taxe de séjour
        </h2>
        <p i18n="@@terms.payment">
          Le paiement en ligne se fait sur la page sécurisée de Stripe : l'hôtel ne reçoit ni ne
          conserve aucune donnée de carte bancaire. La taxe de séjour, fixée par la commune, est
          réglée à l'hôtel.
        </p>
      </section>

      <section class="mt-8 flex flex-col gap-3" aria-labelledby="terms-stay">
        <h2 id="terms-stay" class="section-title" i18n="@@terms.stayTitle">Votre séjour</h2>
        <p>{{ texts.stay }}</p>
      </section>
    </article>
  `,
})
export class TermsPage {
  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();

  protected readonly texts = (() => {
    const rules = this.catalog.bookingRules;
    const hotel = this.catalog.hotel;
    const checkIn = formatTime(hotel.checkInFrom, this.locale);
    const checkOut = formatTime(hotel.checkOutBefore, this.locale);
    const hours = rules.freeCancellationHours;
    const discount = rules.nonRefundableDiscountPercent;
    return {
      flexible: $localize`:@@terms.flexible:Tarif flexible : rien n'est payé à la réservation. Une carte bancaire est demandée en garantie ; le séjour est réglé à l'hôtel.`,
      nonRefundable: $localize`:@@terms.nonRefundable:Tarif non remboursable : ${discount}:discount: % de moins que le tarif flexible, le séjour est payé à la réservation. Il ne peut être ni modifié ni remboursé.`,
      cancel: $localize`:@@terms.cancel:Au tarif flexible, l'annulation est gratuite jusqu'à ${hours}:hours: heures avant le jour d'arrivée à ${checkIn}:time: ; passé ce délai, la première nuit est facturée sur la carte de garantie.`,
      stay: $localize`:@@terms.stay:Les chambres sont disponibles à partir de ${checkIn}:checkIn: le jour de l'arrivée et doivent être libérées avant ${checkOut}:checkOut: le jour du départ. Pour toute question : ${hotel.phone.display}:phone:.`,
    };
  })();
}
