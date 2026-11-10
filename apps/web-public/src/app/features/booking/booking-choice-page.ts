import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { serializeGuests, toSearchQueryParams } from '@riad/shared';
import { BOOKING_RELAY_PATH } from '../../../booking-relay';
import {
  browserSessionStorage,
  loadGuestDraft,
  saveGuestDraft,
} from '../../core/booking/guest-draft';
import { bookingAnswerOf } from '../../core/booking/online-booking';
import { CatalogService } from '../../core/data/catalog.service';
import { countryOptions } from '../../core/i18n/countries';
import { formatPrice } from '../../core/i18n/format';
import { injectLocale } from '../../core/i18n/locale';
import { BOOKING_PATH, CONFIRMATION_PATH, TERMS_PATH } from '../../core/navigation';
import { Notice } from '../../shared/ui/notice';
import { choiceOf } from './booking-model';
import type { SearchPageData } from './booking-route';
import { SearchSummary } from './search-summary';

/** Same shapes as the API, checked here first to spare a round trip. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ().-]{6,30}$/;

type FieldName = 'firstName' | 'lastName' | 'email' | 'phone' | 'acceptTerms';

/**
 * « Vos coordonnées » (step R-4): the offer chosen, read again (prices and stock may have
 * changed), the guest's details and the conditions of sale, then the payment page of Stripe.
 * The browser sends the booking to the relay of the site, never to the API; it is then sent
 * only to a payment page of Stripe. Coming back by « ← Retour » on that page gives the rooms
 * back at once (decision « 3a »).
 */
@Component({
  selector: 'rvp-booking-choice-page',
  imports: [RouterLink, Notice, SearchSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let data = search();
    <div class="container-page max-w-3xl py-8 sm:py-12">
      <h1 class="font-display text-h1-m font-semibold sm:text-h1" i18n="@@choice.title">
        Finaliser votre réservation
      </h1>

      @if (cancelled()) {
        <div class="mt-6">
          <rvp-notice tone="info">
            <p class="font-semibold" i18n="@@choice.cancelledTitle">Paiement annulé</p>
            <p class="mt-1" i18n="@@choice.cancelledText">
              Rien n'a été débité et la chambre n'est plus retenue. Vous pouvez réessayer
              ci-dessous.
            </p>
          </rvp-notice>
        </div>
      }

      @if (chosen(); as offer) {
        <section
          class="mt-6 flex flex-col gap-2 rounded-xl bg-white p-6 shadow-card ring-1 ring-line"
          aria-labelledby="choice-offer"
        >
          <h2 id="choice-offer" class="font-display text-h3-m font-semibold sm:text-h3">
            {{ offer.name }}
          </h2>
          <p class="font-semibold">{{ offer.rate }}</p>
          <p class="text-2xl font-semibold tabular-nums">{{ offer.total }}</p>
          @if (offer.tax; as tax) {
            <p class="text-sm text-muted">{{ tax }}</p>
          }
        </section>

        @if (data.criteria; as criteria) {
          <div class="mt-6">
            <rvp-search-summary [criteria]="criteria" />
          </div>
        }

        <form
          class="mt-8 flex flex-col gap-5 rounded-xl bg-white p-6 shadow-card ring-1 ring-line"
          novalidate
          (submit)="$event.preventDefault(); submit()"
        >
          <h2 class="font-display text-h3-m font-semibold sm:text-h3" i18n="@@choice.formTitle">
            Vos coordonnées
          </h2>
          @if (problem(); as message) {
            <rvp-notice>
              <p>{{ message }}</p>
              @if (gone()) {
                <a
                  class="btn-secondary mt-3"
                  [routerLink]="resultsLink"
                  [queryParams]="searchParams()"
                  i18n="@@choice.back"
                  >Revenir aux résultats</a
                >
              }
            </rvp-notice>
          }

          <div class="grid gap-5 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="guest-first-name" i18n="@@choice.firstName">
                Prénom
              </label>
              <input
                id="guest-first-name"
                class="field-control"
                autocomplete="given-name"
                maxlength="100"
                [attr.aria-invalid]="errorOf('firstName') ? true : null"
                [value]="firstName()"
                (input)="firstName.set(valueOf($event))"
              />
              @if (errorOf('firstName'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="guest-last-name" i18n="@@choice.lastName">
                Nom
              </label>
              <input
                id="guest-last-name"
                class="field-control"
                autocomplete="family-name"
                maxlength="100"
                [attr.aria-invalid]="errorOf('lastName') ? true : null"
                [value]="lastName()"
                (input)="lastName.set(valueOf($event))"
              />
              @if (errorOf('lastName'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="guest-email" i18n="@@choice.email">E-mail</label>
              <input
                id="guest-email"
                class="field-control"
                type="email"
                autocomplete="email"
                maxlength="254"
                [attr.aria-invalid]="errorOf('email') ? true : null"
                [value]="email()"
                (input)="email.set(valueOf($event))"
              />
              @if (errorOf('email'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="guest-phone" i18n="@@choice.phone">Téléphone</label>
              <input
                id="guest-phone"
                class="field-control"
                type="tel"
                autocomplete="tel"
                maxlength="30"
                [attr.aria-invalid]="errorOf('phone') ? true : null"
                [value]="phone()"
                (input)="phone.set(valueOf($event))"
              />
              @if (errorOf('phone'); as message) {
                <p class="field-error">{{ message }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5 sm:col-span-2">
              <label class="field-label" for="guest-country" i18n="@@choice.country">
                Pays (facultatif)
              </label>
              <select
                id="guest-country"
                class="field-control"
                autocomplete="country"
                (change)="country.set(valueOf($event))"
              >
                <option value="" [selected]="country() === ''" i18n="@@choice.countryNone">
                  Non précisé
                </option>
                @for (option of countries; track option.code) {
                  <option [value]="option.code" [selected]="option.code === country()">
                    {{ option.name }}
                  </option>
                }
              </select>
            </div>
            <div class="flex flex-col gap-1.5 sm:col-span-2">
              <label class="field-label" for="guest-message" i18n="@@choice.message">
                Message pour l'hôtel (facultatif)
              </label>
              <textarea
                id="guest-message"
                class="field-control min-h-24"
                maxlength="500"
                [value]="message()"
                (input)="message.set(valueOf($event))"
              ></textarea>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="flex items-start gap-3">
              <input
                class="mt-1 size-5 accent-riad"
                type="checkbox"
                [attr.aria-invalid]="errorOf('acceptTerms') ? true : null"
                [checked]="acceptTerms()"
                (change)="acceptTerms.set(checkedOf($event))"
              />
              <span>
                <span i18n="@@choice.acceptTerms">J'accepte les</span>
                <a
                  class="ms-1 text-port underline"
                  target="_blank"
                  rel="noopener"
                  [routerLink]="termsLink"
                >
                  <span i18n="@@choice.termsLink">conditions de vente et d'annulation</span>
                </a>
              </span>
            </label>
            @if (errorOf('acceptTerms'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>

          <button type="submit" class="btn-primary" [disabled]="sending()">
            {{ sending() ? sendingLabel : offer.button }}
          </button>
          <p class="text-sm text-muted" i18n="@@choice.stripeNote">
            Vous serez dirigé vers la page de paiement sécurisée de Stripe : votre carte n'est
            jamais saisie sur notre site.
          </p>
        </form>
      } @else {
        <div class="mt-6">
          <rvp-notice>
            <p i18n="@@choice.gone">
              Cette offre n'est plus disponible pour ces dates. Revenez aux résultats pour en
              choisir une autre.
            </p>
          </rvp-notice>
        </div>
      }

      <a
        class="btn-secondary mt-8"
        [routerLink]="resultsLink"
        [queryParams]="searchParams()"
        i18n="@@choice.back"
        >Revenir aux résultats</a
      >
    </div>
  `,
})
export class BookingChoicePage implements OnInit {
  /** Read by searchResolver before the page is shown. */
  readonly search = input.required<SearchPageData>();
  /** From the address: « …&category=double-standard&rate=flexible ». */
  readonly category = input<string>();
  readonly rate = input<string>();
  /** Set by the payment page on « ← Retour »: the reference of the booking left. */
  readonly booking = input<string>();

  private readonly catalog = inject(CatalogService);
  private readonly locale = injectLocale();
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly inBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly resultsLink = ['/', BOOKING_PATH];
  protected readonly termsLink = ['/', TERMS_PATH];
  protected readonly countries = countryOptions(this.locale);
  protected readonly sendingLabel = $localize`:@@choice.sending:Préparation du paiement…`;

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  /** France by default on the French site; nothing on the English one. */
  protected readonly country = signal(this.locale === 'fr' ? 'FR' : '');
  protected readonly message = signal('');
  protected readonly acceptTerms = signal(false);

  protected readonly sending = signal(false);
  protected readonly errors = signal<Partial<Record<FieldName, string>>>({});
  protected readonly problem = signal<string | null>(null);
  protected readonly gone = signal(false);
  /** Back by « ← Retour »: told once, until the next sending. */
  protected readonly cancelled = signal(false);

  protected readonly searchParams = computed(() => {
    const criteria = this.search().criteria;
    return criteria === null ? {} : toSearchQueryParams(criteria);
  });

  private readonly choice = computed(() => {
    const result = this.search().result;
    if (result?.kind !== 'found') {
      return null;
    }
    return choiceOf(result.availability, this.category(), this.rate());
  });

  /** The offer in words, or null when it is no longer available. */
  protected readonly chosen = computed(() => {
    const choice = this.choice();
    const category = this.catalog.categories.find((item) => item.code === choice?.offer.code);
    if (choice === null || category === undefined) {
      return null;
    }
    const taxCents = choice.offer.touristTaxCents;
    const total = formatPrice(choice.totalCents, this.locale);
    const flexible = choice.rate === 'flexible';
    return {
      name: category.name,
      rate: flexible
        ? $localize`:@@offer.flexible.name:Tarif flexible`
        : $localize`:@@offer.nonRefundable.name:Non remboursable`,
      total,
      tax:
        taxCents > 0
          ? $localize`:@@choice.touristTax:Taxe de séjour : ${formatPrice(taxCents, this.locale)}:amount:, à régler à l'hôtel`
          : null,
      button: flexible
        ? $localize`:@@choice.saveCard:Enregistrer ma carte et réserver`
        : $localize`:@@choice.pay:Payer ${total}:amount:`,
    };
  });

  ngOnInit(): void {
    if (!this.inBrowser) {
      return;
    }
    // Back from the payment page: the details typed before are given back.
    const draft = loadGuestDraft(browserSessionStorage());
    if (draft !== null) {
      this.firstName.set(draft.firstName);
      this.lastName.set(draft.lastName);
      this.email.set(draft.email);
      this.phone.set(draft.phone);
      this.country.set(draft.country);
    }
    const reference = this.booking();
    if (reference === undefined) {
      return;
    }
    this.cancelled.set(true);
    // « ← Retour » on the payment page: the rooms are given back at once, then the offer is
    // read again without them (the reference leaves the address).
    void fetch(`${BOOKING_RELAY_PATH}/${encodeURIComponent(reference)}/abandon`, { method: 'POST' })
      .catch(() => undefined)
      .then(() =>
        this.router.navigate([], {
          queryParams: { booking: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
      );
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected errorOf(field: FieldName): string | undefined {
    return this.errors()[field];
  }

  private localErrors(): Partial<Record<FieldName, string>> {
    const errors: Partial<Record<FieldName, string>> = {};
    const required = $localize`:@@choice.required:Champ obligatoire.`;
    if (this.firstName().trim() === '') {
      errors.firstName = required;
    }
    if (this.lastName().trim() === '') {
      errors.lastName = required;
    }
    if (!EMAIL.test(this.email().trim())) {
      errors.email = $localize`:@@choice.emailInvalid:Adresse e-mail invalide.`;
    }
    if (!PHONE.test(this.phone().trim())) {
      errors.phone = $localize`:@@choice.phoneInvalid:Numéro de téléphone invalide.`;
    }
    if (!this.acceptTerms()) {
      errors.acceptTerms = $localize`:@@choice.termsRequired:Acceptez les conditions de vente pour réserver.`;
    }
    return errors;
  }

  /** The page Stripe sends back to after the payment; it replaces « {CHECKOUT_SESSION_ID} ». */
  private confirmationUrl(): string {
    const page = new URL(`${BOOKING_PATH}/${CONFIRMATION_PATH}`, this.document.baseURI).href;
    return `${page}?session={CHECKOUT_SESSION_ID}`;
  }

  /** This page, for « ← Retour » (the API adds the reference of the booking). */
  private returnUrl(): string {
    const url = new URL(this.document.location.href);
    url.searchParams.delete('booking');
    return url.href;
  }

  protected async submit(): Promise<void> {
    const choice = this.choice();
    const criteria = this.search().criteria;
    if (choice === null || criteria === null || this.sending()) {
      return;
    }
    this.problem.set(null);
    this.gone.set(false);
    this.cancelled.set(false);
    const errors = this.localErrors();
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    this.sending.set(true);
    saveGuestDraft(browserSessionStorage(), {
      firstName: this.firstName().trim(),
      lastName: this.lastName().trim(),
      email: this.email().trim(),
      phone: this.phone().trim(),
      country: this.country(),
    });
    const message = this.message().trim();
    const body = {
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      guests: serializeGuests(criteria.rooms),
      category: choice.offer.code,
      ratePlan: choice.rate === 'flexible' ? 'flexible' : 'non_refundable',
      customer: {
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        email: this.email().trim(),
        phone: this.phone().trim(),
        countryCode: this.country() === '' ? null : this.country(),
      },
      language: this.locale,
      message: message === '' ? null : message,
      acceptTerms: true,
      successUrl: this.confirmationUrl(),
      cancelUrl: this.returnUrl(),
    };
    let status = 502;
    let answerBody: unknown = null;
    try {
      const response = await fetch(BOOKING_RELAY_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // One key per sending: the button stays disabled meanwhile (no double booking).
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      status = response.status;
      answerBody = (await response.json()) as unknown;
    } catch {
      // Network lost: shown below as an outage.
    }
    const answer = bookingAnswerOf({ status, body: answerBody });
    if (answer.kind === 'redirect') {
      this.document.location.assign(answer.url);
      return;
    }
    this.sending.set(false);
    const phone = this.catalog.hotel.phone.display;
    switch (answer.kind) {
      case 'invalid':
        this.errors.set(answer.fields);
        this.problem.set($localize`:@@choice.invalid:Vérifiez les champs signalés.`);
        break;
      case 'gone':
        this.gone.set(true);
        this.problem.set(
          $localize`:@@choice.taken:Cette chambre vient d'être réservée pour ces dates. Revenez aux résultats pour en choisir une autre.`,
        );
        break;
      case 'busy':
        this.problem.set(
          $localize`:@@choice.busy:Trop de tentatives en peu de temps. Réessayez dans quelques minutes.`,
        );
        break;
      default:
        this.problem.set(
          $localize`:@@choice.unavailable:Paiement momentanément indisponible. Rien n'a été réservé : réessayez dans quelques minutes ou appelez la réception au ${phone}:phone:.`,
        );
    }
  }
}
