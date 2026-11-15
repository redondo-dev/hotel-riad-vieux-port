import { DOCUMENT, isPlatformBrowser, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { daysBetween, manageAccessOf } from '@riad/shared';
import { BOOKING_RELAY_PATH, type ManageAccess, type RelayAnswer } from '../../../booking-relay';
import { type ManageState, manageStateOf } from '../../core/booking/managed-booking';
import { CatalogService } from '../../core/data/catalog.service';
import { nightsLabel } from '../../core/i18n/counts';
import { formatDate, formatInstant, formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { Notice } from '../../shared/ui/notice';

type PageState = ManageState | { kind: 'loading' } | { kind: 'none' };

/**
 * « Gérer ma réservation » (step M). The secret link « …#REFERENCE.token » is read in the
 * browser only (the part after # never reaches a server), then removed from the address bar at
 * once: it stays neither in the history nor in a copied address. The booking is read through
 * the relay of the site, the token in the body. Never indexed (robots « noindex »).
 *
 * Without a link, or with a link no longer valid: the form « Lien perdu », whose answer never
 * tells whether a booking exists.
 */
@Component({
  selector: 'rvp-manage-booking-page',
  imports: [Notice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-page max-w-3xl py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@manage.title">
        Gérer ma réservation
      </h1>

      @switch (state().kind) {
        @case ('loading') {
          <p class="mt-6 text-muted" i18n="@@manage.loading">Chargement de votre réservation…</p>
        }
        @case ('busy') {
          <div class="mt-6">
            <rvp-notice>
              <p>{{ busyText }}</p>
            </rvp-notice>
          </div>
        }
        @case ('unavailable') {
          <div class="mt-6">
            <rvp-notice>
              <p>{{ unavailableText }}</p>
            </rvp-notice>
          </div>
        }
        @case ('found') {
          @if (view(); as booking) {
            <p class="mt-6 text-lg">{{ booking.hello }}</p>
            <p class="mt-4 text-muted" i18n="@@confirmation.reference">Votre référence</p>
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

            <section class="mt-8" aria-labelledby="manage-cancellation">
              <h2
                id="manage-cancellation"
                class="font-display text-xl font-semibold"
                i18n="@@manage.cancellationTitle"
              >
                Annulation
              </h2>
              @if (cancelError(); as message) {
                <div class="mt-4">
                  <rvp-notice>
                    <p>{{ message }}</p>
                  </rvp-notice>
                </div>
              }
              @switch (booking.cancellation) {
                @case ('free') {
                  <p class="mt-3">{{ booking.freeText }}</p>
                  @if (confirming()) {
                    <div class="mt-4 rounded-xl bg-white p-5 ring-1 ring-line">
                      <p class="font-semibold" i18n="@@manage.confirmQuestion">
                        Annuler définitivement votre réservation ?
                      </p>
                      <p class="mt-1 text-muted" i18n="@@manage.confirmDetail">
                        Les chambres seront libérées et rien ne sera débité. Cette action ne peut
                        pas être annulée.
                      </p>
                      <div class="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          class="btn-primary"
                          [disabled]="cancelling()"
                          (click)="cancel()"
                          i18n="@@manage.confirmYes"
                        >
                          Oui, annuler ma réservation
                        </button>
                        <button
                          type="button"
                          class="btn-secondary"
                          [disabled]="cancelling()"
                          (click)="confirming.set(false)"
                          i18n="@@manage.confirmNo"
                        >
                          Non, la garder
                        </button>
                      </div>
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="btn-secondary mt-4"
                      (click)="confirming.set(true)"
                      i18n="@@manage.cancelButton"
                    >
                      Annuler ma réservation
                    </button>
                  }
                }
                @case ('with_fee') {
                  <p class="mt-3">{{ withFeeText }}</p>
                }
                @case ('not_refundable') {
                  <p class="mt-3">{{ notRefundableText }}</p>
                }
                @default {
                  <p class="mt-3">{{ closedText }}</p>
                }
              }
            </section>
          }
        }
        @default {
          <div class="mt-6">
            @if (state().kind === 'invalid') {
              <rvp-notice>
                <p>{{ invalidText }}</p>
              </rvp-notice>
            } @else {
              <p i18n="@@manage.intro">
                Pour consulter ou annuler votre réservation, utilisez le lien reçu par e-mail.
              </p>
            }
          </div>
        }
      }

      @if (state().kind === 'invalid' || state().kind === 'none') {
        <form
          class="mt-8 flex flex-col gap-5 rounded-xl bg-white p-6 shadow-card ring-1 ring-line"
          (submit)="requestLink($event)"
          novalidate
        >
          <div>
            <h2 class="font-display text-xl font-semibold" i18n="@@manage.lostTitle">
              Vous avez perdu le lien ?
            </h2>
            <p class="mt-1 text-muted" i18n="@@manage.lostIntro">
              Indiquez votre référence et l'e-mail de la réservation : nous vous envoyons un nouveau
              lien, qui remplace les précédents.
            </p>
          </div>
          <div class="grid gap-5 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="manage-reference" i18n="@@manage.reference">
                Référence
              </label>
              <input
                id="manage-reference"
                class="field-control uppercase tracking-widest"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                maxlength="8"
                [value]="reference()"
                (input)="reference.set(valueOf($event))"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="manage-email" i18n="@@manage.email">E-mail</label>
              <input
                id="manage-email"
                type="email"
                class="field-control"
                autocomplete="email"
                maxlength="254"
                [value]="email()"
                (input)="email.set(valueOf($event))"
              />
            </div>
          </div>
          @if (linkMessage(); as message) {
            <rvp-notice [tone]="message.tone">
              <p>{{ message.text }}</p>
            </rvp-notice>
          }
          <div>
            <button
              type="submit"
              class="btn-primary"
              [disabled]="linkSending()"
              i18n="@@manage.lostButton"
            >
              Recevoir un nouveau lien
            </button>
          </div>
        </form>
      }
    </div>
  `,
})
export class ManageBookingPage implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();
  private readonly document = inject(DOCUMENT);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly meta = inject(Meta);
  private readonly inBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly phone = this.catalog.hotel.phone.display;
  protected readonly busyText = $localize`:@@manage.busy:Trop de tentatives depuis votre connexion. Réessayez dans une minute.`;
  protected readonly unavailableText = $localize`:@@manage.unavailable:Votre réservation ne peut pas être affichée pour l'instant. Réessayez dans quelques instants ou appelez la réception au ${this.phone}:phone:.`;
  protected readonly invalidText = $localize`:@@manage.invalid:Ce lien n'est pas ou plus valide. Demandez-en un nouveau ci-dessous, ou appelez la réception au ${this.phone}:phone:.`;
  protected readonly withFeeText = $localize`:@@manage.withFee:La date d'annulation gratuite est passée : une nuit est due en cas d'annulation. Pour annuler, appelez la réception au ${this.phone}:phone:.`;
  protected readonly notRefundableText = $localize`:@@manage.notRefundable:Ce tarif n'est ni annulable ni remboursable. Pour toute question, appelez la réception au ${this.phone}:phone:.`;
  protected readonly closedText = $localize`:@@manage.closed:Cette réservation ne peut plus être modifiée en ligne. Pour toute question, appelez la réception au ${this.phone}:phone:.`;

  protected readonly state = signal<PageState>({ kind: 'loading' });
  /** The secret link, kept in memory only for the cancellation. */
  private access: ManageAccess | null = null;
  protected readonly confirming = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly cancelError = signal<string | null>(null);

  protected readonly reference = signal('');
  protected readonly email = signal('');
  protected readonly linkSending = signal(false);
  protected readonly linkMessage = signal<{ tone: 'info' | 'danger'; text: string } | null>(null);

  constructor() {
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    inject(DestroyRef).onDestroy(() => {
      this.meta.removeTag('name="robots"');
    });
  }

  ngOnInit(): void {
    // On the server, the part after # is unknown: the browser reads the link.
    if (!this.inBrowser) {
      return;
    }
    const hash = this.document.location.hash;
    const access = manageAccessOf(hash);
    if (hash !== '') {
      // The token leaves the address bar at once.
      this.location.replaceState(this.router.url.split('#')[0] ?? '/');
    }
    if (access === null) {
      this.state.set({ kind: hash === '' ? 'none' : 'invalid' });
      return;
    }
    this.access = access;
    void this.post('manage', access).then((answer) => {
      this.state.set(manageStateOf(answer));
    });
  }

  protected readonly view = computed(() => {
    const state = this.state();
    if (state.kind !== 'found') {
      return null;
    }
    const booking = state.booking;
    const category = this.catalog.categories.find((item) => item.code === booking.category);
    const name = category?.name ?? booking.category ?? '';
    const nights = nightsLabel(daysBetween(booking.checkIn, booking.checkOut));
    const dateFormat: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    };
    const price = (cents: number): string | null =>
      cents > 0 ? formatPrice(cents, this.locale) : null;
    const { timeZone } = this.catalog.hotel;
    const instantFormat = { ...dateFormat, hour: '2-digit', minute: '2-digit' } as const;
    const until = booking.freeCancellationUntil;
    const deadline =
      until === null ? '' : formatInstant(until, this.locale, timeZone, instantFormat);
    return {
      reference: booking.reference,
      status: booking.status,
      cancellation: booking.cancellation,
      hello: $localize`:@@manage.hello:Bonjour ${booking.firstName}:name:,`,
      statusText: {
        pending: $localize`:@@confirmation.pending:Paiement en cours de vérification : votre réservation sera confirmée dans quelques instants.`,
        confirmed: $localize`:@@confirmation.confirmed:Votre réservation est confirmée.`,
        cancelled: $localize`:@@manage.cancelled:Cette réservation est annulée.`,
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
      freeText: $localize`:@@manage.free:Annulation gratuite jusqu'au ${deadline}:deadline: (heure de Marseille). Rien n'a été débité : votre carte sert seulement de garantie.`,
    };
  });

  /** After the confirmation: cancelled at no cost (the API checks again that it may be). */
  protected async cancel(): Promise<void> {
    if (this.access === null || this.cancelling()) {
      return;
    }
    this.cancelling.set(true);
    this.cancelError.set(null);
    const answer = await this.post('manage/cancel', this.access);
    this.cancelling.set(false);
    this.confirming.set(false);
    if (answer.status === 200) {
      this.state.set(manageStateOf(answer));
      return;
    }
    this.cancelError.set(
      answer.status === 409
        ? $localize`:@@manage.cancelRefused:Cette réservation ne peut plus être annulée en ligne : appelez la réception au ${this.phone}:phone:.`
        : $localize`:@@manage.cancelFailed:L'annulation n'a pas pu être faite. Réessayez dans quelques instants ou appelez la réception au ${this.phone}:phone:.`,
    );
    if (answer.status === 409) {
      // The deadline has just passed: the page shows the conditions now in force.
      this.state.set(manageStateOf(await this.post('manage', this.access)));
    }
  }

  /** « Lien perdu »: the answer is the same whether the booking exists or not. */
  protected async requestLink(event: Event): Promise<void> {
    event.preventDefault();
    const reference = this.reference().trim().toUpperCase();
    const email = this.email().trim();
    if (reference === '' || !email.includes('@')) {
      this.linkMessage.set({
        tone: 'danger',
        text: $localize`:@@manage.lostMissing:Indiquez la référence et l'e-mail de la réservation.`,
      });
      return;
    }
    this.linkSending.set(true);
    const answer = await this.post('manage/link', { reference, email });
    this.linkSending.set(false);
    if (answer.status === 202) {
      this.linkMessage.set({
        tone: 'info',
        text: $localize`:@@manage.lostSent:Si cette réservation existe et correspond à cet e-mail, un nouveau lien vient d'y être envoyé. Pensez à regarder vos courriers indésirables.`,
      });
    } else if (answer.status === 429) {
      this.linkMessage.set({
        tone: 'danger',
        text: $localize`:@@manage.lostBusy:Trop de demandes depuis votre connexion : réessayez dans une heure.`,
      });
    } else if (answer.status === 400) {
      this.linkMessage.set({
        tone: 'danger',
        text: $localize`:@@manage.lostInvalid:Vérifiez l'adresse e-mail.`,
      });
    } else {
      this.linkMessage.set({ tone: 'danger', text: this.unavailableText });
    }
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** One call of the relay of the site; 502 when it does not answer. */
  private async post(path: string, body: unknown): Promise<RelayAnswer> {
    try {
      const response = await fetch(`${BOOKING_RELAY_PATH}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await response.json().catch(() => null);
      return { status: response.status, body: parsed };
    } catch {
      return { status: 502, body: null };
    }
  }
}
