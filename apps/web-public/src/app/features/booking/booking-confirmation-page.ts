import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { daysBetween } from '@riad/shared';
import { browserSessionStorage, clearGuestDraft } from '../../core/booking/guest-draft';
import { CatalogService } from '../../core/data/catalog.service';
import { nightsLabel } from '../../core/i18n/counts';
import { formatDate, formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { SEARCH_ANCHOR } from '../../core/navigation';
import { Notice } from '../../shared/ui/notice';
import type { ConfirmationData } from './confirmation-route';

/**
 * Back from the payment page of Stripe (step R-4): the reference of the booking, the stay and
 * the amounts, and its state. No personal data (decision « 4 »): the address of this page may
 * be shared. « En cours de vérification » until Stripe tells the hotel (step R-5).
 */
@Component({
  selector: 'rvp-booking-confirmation-page',
  imports: [RouterLink, Notice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-page max-w-3xl py-8 sm:py-12">
      @switch (data().kind) {
        @case ('found') {
          @if (view(); as booking) {
            <h1 class="font-display text-h1-m font-semibold sm:text-h1">{{ booking.title }}</h1>

            <p class="mt-6 text-muted" i18n="@@confirmation.reference">Votre référence</p>
            <p class="font-display text-3xl font-semibold tracking-widest">
              {{ booking.reference }}
            </p>

            <div class="mt-6">
              <rvp-notice [tone]="booking.status === 'cancelled' ? 'danger' : 'info'">
                <p>{{ booking.statusText }}</p>
              </rvp-notice>
            </div>

            <dl
              class="mt-6 grid gap-4 rounded-xl bg-white p-6 shadow-card ring-1 ring-line sm:grid-cols-2"
            >
              <div>
                <dt class="text-sm text-muted" i18n="@@confirmation.room">Chambre</dt>
                <dd class="mt-1 font-semibold">{{ booking.room }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted" i18n="@@confirmation.rate">Tarif</dt>
                <dd class="mt-1 font-semibold">{{ booking.rate }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted" i18n="@@booking.arrival">Arrivée</dt>
                <dd class="mt-1 font-semibold first-letter:uppercase">{{ booking.checkIn }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted" i18n="@@booking.departure">Départ</dt>
                <dd class="mt-1 font-semibold first-letter:uppercase">{{ booking.checkOut }}</dd>
              </div>
              @if (booking.paidOnline; as paid) {
                <div>
                  <dt class="text-sm text-muted" i18n="@@confirmation.paidOnline">Payé en ligne</dt>
                  <dd class="mt-1 font-semibold tabular-nums">{{ paid }}</dd>
                </div>
              }
              @if (booking.dueAtHotel; as due) {
                <div>
                  <dt class="text-sm text-muted" i18n="@@confirmation.dueAtHotel">
                    À régler à l'hôtel
                  </dt>
                  <dd class="mt-1 font-semibold tabular-nums">{{ due }}</dd>
                </div>
              }
            </dl>

            @if (booking.status !== 'cancelled') {
              <p class="mt-6" i18n="@@confirmation.email">
                Un e-mail de confirmation vous sera envoyé. Gardez votre référence : elle vous sera
                demandée à la réception.
              </p>
            }
          }
        }
        @case ('missing') {
          <h1
            class="font-display text-h1-m font-semibold sm:text-h1"
            i18n="@@confirmation.missingTitle"
          >
            Réservation introuvable
          </h1>
          <div class="mt-6">
            <rvp-notice>
              <p>{{ missingText }}</p>
            </rvp-notice>
          </div>
        }
        @default {
          <h1
            class="font-display text-h1-m font-semibold sm:text-h1"
            i18n="@@confirmation.unavailableTitle"
          >
            Merci pour votre réservation
          </h1>
          <div class="mt-6">
            <rvp-notice tone="info">
              <p>{{ unavailableText }}</p>
            </rvp-notice>
          </div>
        }
      }

      <a
        class="btn-secondary mt-8"
        routerLink="/"
        [fragment]="searchAnchor"
        i18n="@@confirmation.home"
        >Retour à l'accueil</a
      >
    </div>
  `,
})
export class BookingConfirmationPage implements OnInit {
  /** Read by confirmationResolver before the page is shown. */
  readonly data = input.required<ConfirmationData>();

  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();
  protected readonly searchAnchor = SEARCH_ANCHOR;
  private readonly inBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly phone = this.catalog.hotel.phone.display;
  protected readonly missingText = $localize`:@@confirmation.missingText:Aucune réservation ne correspond à cette adresse. Si vous avez payé, appelez la réception au ${this.phone}:phone: avec votre e-mail.`;
  protected readonly unavailableText = $localize`:@@confirmation.unavailableText:Votre réservation est enregistrée, mais son détail ne peut pas être affiché pour l'instant. Vous recevrez un e-mail de confirmation ; pour toute question, appelez la réception au ${this.phone}:phone:.`;

  ngOnInit(): void {
    const data = this.data();
    // The booking is recorded: the details kept in the tab are no longer needed.
    if (this.inBrowser && data.kind === 'found' && data.summary.status !== 'cancelled') {
      clearGuestDraft(browserSessionStorage());
    }
  }

  protected readonly view = computed(() => {
    const data = this.data();
    if (data.kind !== 'found') {
      return null;
    }
    const booking = data.summary;
    const category = this.catalog.categories.find((item) => item.code === booking.category);
    const name = category?.name ?? booking.category ?? '';
    const dateFormat: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    };
    const nights = nightsLabel(daysBetween(booking.checkIn, booking.checkOut));
    const price = (cents: number): string | null =>
      cents > 0 ? formatPrice(cents, this.locale) : null;
    return {
      reference: booking.reference,
      status: booking.status,
      title:
        booking.status === 'cancelled'
          ? $localize`:@@confirmation.cancelledTitle:Cette réservation n'est plus active`
          : $localize`:@@confirmation.title:Merci, votre réservation est enregistrée`,
      statusText: {
        pending: $localize`:@@confirmation.pending:Paiement en cours de vérification : votre réservation sera confirmée dans quelques instants.`,
        confirmed: $localize`:@@confirmation.confirmed:Votre réservation est confirmée.`,
        cancelled: $localize`:@@confirmation.cancelled:Le paiement n'a pas abouti : aucune chambre n'est retenue et rien n'a été débité.`,
      }[booking.status],
      room:
        booking.roomCount > 1
          ? $localize`:@@confirmation.rooms:${booking.roomCount}:count: × ${name}:name: · ${nights}:nights:`
          : `${name} · ${nights}`,
      rate:
        booking.ratePlan === 'flexible'
          ? $localize`:@@offer.flexible.name:Tarif flexible`
          : $localize`:@@offer.nonRefundable.name:Non remboursable`,
      checkIn: formatDate(booking.checkIn, this.locale, dateFormat),
      checkOut: formatDate(booking.checkOut, this.locale, dateFormat),
      paidOnline: price(booking.paidOnlineCents),
      dueAtHotel: price(booking.dueAtHotelCents),
    };
  });
}
