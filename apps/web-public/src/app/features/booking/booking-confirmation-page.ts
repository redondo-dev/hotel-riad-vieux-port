import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { daysBetween } from '@riad/shared';
import { checkoutReader } from '../../core/booking/checkout-reader';
import {
  isSlow,
  REFRESH_EVERY_MS,
  refreshedSummary,
  shouldRefresh,
} from '../../core/booking/confirmation-refresh';
import { browserSessionStorage, clearGuestDraft } from '../../core/booking/guest-draft';
import type { BookingSummary } from '../../core/booking/online-booking';
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
 * be shared. « En cours de vérification » until Stripe tells the hotel (step R-5): the page reads
 * the booking again every 3 seconds, for 30 seconds at most, in the browser only (step R-5c).
 * The box of the state is a live region: screen readers announce its changes.
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
                @if (slow()) {
                  <p class="mt-2">{{ slowText }}</p>
                }
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
                  <dt class="text-sm text-muted">
                    @if (booking.status === 'pending') {
                      <ng-container i18n="@@confirmation.dueOnline">À payer en ligne</ng-container>
                    } @else {
                      <ng-container i18n="@@confirmation.paidOnline">Payé en ligne</ng-container>
                    }
                  </dt>
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
  private readonly read = checkoutReader();
  private readonly destroyRef = inject(DestroyRef);

  /** The state read again while the payment is being checked; first, the one of the resolver. */
  private readonly refreshed = signal<BookingSummary | null>(null);
  /** Reads made since the page opened. */
  private readonly refreshes = signal(0);
  /** The page was left: no more reads. */
  private left = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly phone = this.catalog.hotel.phone.display;
  protected readonly missingText = $localize`:@@confirmation.missingText:Aucune réservation ne correspond à cette adresse. Si vous avez payé, appelez la réception au ${this.phone}:phone: avec votre e-mail.`;
  protected readonly slowText = $localize`:@@confirmation.slow:La confirmation prend plus de temps que prévu. Actualisez la page dans quelques instants ; votre réservation reste enregistrée.`;
  protected readonly unavailableText = $localize`:@@confirmation.unavailableText:Votre réservation est enregistrée, mais son détail ne peut pas être affiché pour l'instant. Vous recevrez un e-mail de confirmation ; pour toute question, appelez la réception au ${this.phone}:phone:.`;

  /** What is shown now: the last state read, or the one of the resolver. */
  private readonly summary = computed(() => {
    const data = this.data();
    if (data.kind !== 'found') {
      return null;
    }
    return this.refreshed() ?? data.summary;
  });

  protected readonly slow = computed(() => {
    const summary = this.summary();
    return summary !== null && isSlow(summary, this.refreshes());
  });

  ngOnInit(): void {
    const data = this.data();
    if (!this.inBrowser || data.kind !== 'found') {
      return;
    }
    // The booking is recorded: the details kept in the tab are no longer needed.
    if (data.summary.status !== 'cancelled') {
      clearGuestDraft(browserSessionStorage());
    }
    this.destroyRef.onDestroy(() => {
      this.left = true;
      clearTimeout(this.timer);
    });
    this.refreshLater(data.sessionId);
  }

  /** Reads the booking again in 3 seconds while it is being checked. */
  private refreshLater(sessionId: string): void {
    const summary = this.summary();
    if (this.left || summary === null || !shouldRefresh(summary, this.refreshes())) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.read(sessionId).then((answer) => {
        if (this.left) {
          return;
        }
        this.refreshed.set(refreshedSummary(summary, answer));
        this.refreshes.update((done) => done + 1);
        this.refreshLater(sessionId);
      });
    }, REFRESH_EVERY_MS);
  }

  protected readonly view = computed(() => {
    const booking = this.summary();
    if (booking === null) {
      return null;
    }
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
      title: {
        pending: $localize`:@@confirmation.title:Merci, votre réservation est enregistrée`,
        confirmed: $localize`:@@confirmation.confirmedTitle:Merci, votre réservation est confirmée`,
        cancelled: $localize`:@@confirmation.cancelledTitle:Cette réservation n'est plus active`,
      }[booking.status],
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
