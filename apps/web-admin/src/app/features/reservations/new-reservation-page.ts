import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCircleAlert,
  LucidePlus,
  LucideSearch,
  LucideX,
} from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { NotifierService } from '../../core/notifier.service';
import { CatalogApi } from '../catalog/catalog-api';
import type { HotelService } from '../catalog/catalog-model';
import {
  type AvailabilityAnswer,
  type CategoryAvailability,
  type CustomerChoice,
  type Occupancy,
  roomPrice,
  roomsTotal,
  serviceQuantity,
  unavailableReason,
} from './booking-model';
import { type NewBooking, ReservationApi } from './reservation-api';
import { formatEuros, guestsText, parseAges, type RatePlan } from './reservation-model';

/** One room as typed: the ages are a text, « 6, 3 ». */
interface RoomDraft {
  adults: number;
  ages: string;
  babyCot: boolean;
}

interface StayDraft {
  checkIn: string;
  checkOut: string;
  rooms: RoomDraft[];
}

interface CustomerDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredLanguage: 'fr' | 'en';
}

const MAX_ROOMS = 5;
const ADULT_CHOICES = [1, 2, 3, 4] as const;
const EMPTY_CUSTOMER: CustomerDraft = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  preferredLanguage: 'fr',
};

/** « YYYY-MM-DD » of today at the hotel, and the day after. */
function hotelDay(offset: number): string {
  const day = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(day);
}

/**
 * A booking taken on the phone or at the desk (UI/UX specification, section 5.D), one page in
 * three blocks: the stay with the availability and the prices of each room, the customer
 * (found or new), then the summary. The online limits do not apply. The API checks everything
 * again, and the same key is sent for the whole form: a double click creates nothing more.
 */
@Component({
  selector: 'adm-new-reservation-page',
  imports: [RouterLink, LucideArrowLeft, LucideCircleAlert, LucidePlus, LucideSearch, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/reservations" class="mb-4 -ml-3 btn-quiet">
      <svg lucideArrowLeft></svg>
      Retour aux réservations
    </a>

    <form
      class="flex max-w-4xl flex-col gap-4"
      novalidate
      (submit)="$event.preventDefault(); create()"
    >
      <section class="card flex flex-col gap-4 p-5" aria-labelledby="titre-sejour">
        <h2 id="titre-sejour" class="text-lg font-semibold">1. Séjour et chambres</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="nouvelle-arrivee">Arrivée</label>
            <input
              id="nouvelle-arrivee"
              type="date"
              class="field-control"
              [attr.aria-invalid]="error('checkIn') ? true : null"
              [value]="stay().checkIn"
              (change)="patchStay({ checkIn: valueOf($event) })"
            />
            @if (error('checkIn'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="nouvelle-depart">Départ</label>
            <input
              id="nouvelle-depart"
              type="date"
              class="field-control"
              [attr.aria-invalid]="error('checkOut') ? true : null"
              [value]="stay().checkOut"
              (change)="patchStay({ checkOut: valueOf($event) })"
            />
            @if (error('checkOut'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        </div>

        @for (room of stay().rooms; track $index; let index = $index) {
          <fieldset class="flex flex-col gap-3 rounded-lg border border-line p-4">
            <legend class="px-1 text-sm font-semibold">Chambre {{ index + 1 }}</legend>
            <div class="flex flex-wrap items-end gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="field-label" [for]="'nouvelle-adultes-' + index">Adultes</label>
                <select
                  class="field-control w-24"
                  [id]="'nouvelle-adultes-' + index"
                  (change)="patchRoom(index, { adults: numberOf($event) })"
                >
                  @for (count of adultChoices; track count) {
                    <option [value]="count" [selected]="room.adults === count">{{ count }}</option>
                  }
                </select>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" [for]="'nouvelle-ages-' + index">Âges des enfants</label>
                <input
                  class="field-control w-40"
                  autocomplete="off"
                  placeholder="6, 3"
                  [id]="'nouvelle-ages-' + index"
                  [attr.aria-invalid]="error('rooms[' + index + ']') ? true : null"
                  [value]="room.ages"
                  (input)="patchRoom(index, { ages: valueOf($event) })"
                />
              </div>
              <label class="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  class="size-5 accent-port"
                  [checked]="room.babyCot"
                  (change)="patchRoom(index, { babyCot: !room.babyCot })"
                />
                Lit bébé
              </label>
              @if (stay().rooms.length > 1) {
                <button type="button" class="ml-auto btn-quiet" (click)="removeRoom(index)">
                  <svg lucideX></svg>
                  Retirer
                </button>
              }
            </div>
            @if (error('rooms[' + index + ']'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </fieldset>
        }

        <div class="flex flex-wrap gap-3">
          @if (stay().rooms.length < maxRooms) {
            <button type="button" class="btn-quiet" (click)="addRoom()">
              <svg lucidePlus></svg>
              Ajouter une chambre
            </button>
          }
          <button
            type="button"
            class="ml-auto btn-primary"
            [disabled]="searching()"
            (click)="search()"
          >
            <svg lucideSearch></svg>
            Voir les disponibilités
          </button>
        </div>

        @if (searchProblem(); as problem) {
          @if (problem.errors.length === 0) {
            <div class="alert-error" role="alert">
              <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
              <p>
                <span class="font-semibold">{{ problem.title }}.</span> {{ problem.detail }}
              </p>
            </div>
          }
        }

        @if (availability(); as answer) {
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm font-semibold">Tarif (toute la réservation)</legend>
            <label class="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="tarif"
                class="size-5 accent-port"
                [checked]="ratePlan() === 'flexible'"
                (change)="ratePlan.set('flexible')"
              />
              Flexible : annulation gratuite jusqu’à 48 h avant l’arrivée
            </label>
            <label class="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="tarif"
                class="size-5 accent-port"
                [checked]="ratePlan() === 'non_refundable'"
                (change)="ratePlan.set('non_refundable')"
              />
              Non remboursable : moins cher, aucun remboursement
            </label>
          </fieldset>

          @for (requested of answer.rooms; track $index; let index = $index) {
            <fieldset class="flex flex-col gap-1 rounded-lg border border-line p-4">
              <legend class="px-1 text-sm font-semibold">{{ roomLegend(requested, index) }}</legend>
              @for (category of answer.categories; track category.id) {
                <label
                  class="flex min-h-11 flex-wrap items-center gap-x-3"
                  [class.text-muted]="reason(category, index) !== null"
                >
                  <input
                    type="radio"
                    class="size-5 accent-port"
                    [name]="'categorie-' + index"
                    [disabled]="reason(category, index) !== null"
                    [checked]="choices()[index] === category.id"
                    (change)="choose(index, category.id)"
                  />
                  <span class="font-medium">{{ category.name }}</span>
                  <span>{{ offerText(category, index) }}</span>
                </label>
              }
            </fieldset>
          }
        }
      </section>

      @if (availability()) {
        <section class="card flex flex-col gap-4 p-5" aria-labelledby="titre-client">
          <h2 id="titre-client" class="text-lg font-semibold">2. Client</h2>
          <div
            class="flex w-fit rounded-lg border border-field bg-white p-1"
            role="group"
            aria-label="Client"
          >
            <button
              type="button"
              class="h-9 rounded-md px-4 font-medium"
              [class.bg-port]="customerMode() === 'existing'"
              [class.text-white]="customerMode() === 'existing'"
              [attr.aria-pressed]="customerMode() === 'existing'"
              (click)="customerMode.set('existing')"
            >
              Client existant
            </button>
            <button
              type="button"
              class="h-9 rounded-md px-4 font-medium"
              [class.bg-port]="customerMode() === 'new'"
              [class.text-white]="customerMode() === 'new'"
              [attr.aria-pressed]="customerMode() === 'new'"
              (click)="customerMode.set('new')"
            >
              Nouveau client
            </button>
          </div>

          @if (customerMode() === 'existing') {
            <div class="flex flex-wrap items-end gap-3">
              <div class="flex min-w-60 flex-1 flex-col gap-1.5">
                <label class="field-label" for="client-recherche">Nom ou e-mail</label>
                <input
                  id="client-recherche"
                  type="search"
                  class="field-control"
                  autocomplete="off"
                  [value]="customerQuery()"
                  (input)="customerQuery.set(valueOf($event))"
                  (keydown.enter)="$event.preventDefault(); searchCustomers()"
                />
              </div>
              <button type="button" class="btn-secondary" (click)="searchCustomers()">
                <svg lucideSearch></svg>
                Chercher
              </button>
            </div>
            @if (customerResults(); as results) {
              <fieldset class="flex flex-col gap-1">
                <legend class="sr-only">Clients trouvés</legend>
                @for (customer of results; track customer.id) {
                  <label class="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="client"
                      class="size-5 accent-port"
                      [checked]="chosenCustomer()?.id === customer.id"
                      (change)="chosenCustomer.set(customer)"
                    />
                    {{ customerText(customer) }}
                  </label>
                } @empty {
                  <p class="text-sm text-muted">
                    Aucun client trouvé : saisissez un nouveau client.
                  </p>
                }
              </fieldset>
            }
            @if (error('customer.id'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          } @else {
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="client-prenom">Prénom</label>
                <input
                  id="client-prenom"
                  class="field-control"
                  autocomplete="off"
                  [attr.aria-invalid]="error('newCustomer.firstName') ? true : null"
                  [value]="customer().firstName"
                  (input)="patchCustomer({ firstName: valueOf($event) })"
                />
                @if (error('newCustomer.firstName'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="client-nom">Nom</label>
                <input
                  id="client-nom"
                  class="field-control"
                  autocomplete="off"
                  [attr.aria-invalid]="error('newCustomer.lastName') ? true : null"
                  [value]="customer().lastName"
                  (input)="patchCustomer({ lastName: valueOf($event) })"
                />
                @if (error('newCustomer.lastName'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="client-email">E-mail</label>
                <input
                  id="client-email"
                  type="email"
                  class="field-control"
                  autocomplete="off"
                  [attr.aria-invalid]="error('newCustomer.email') ? true : null"
                  [value]="customer().email"
                  (input)="patchCustomer({ email: valueOf($event) })"
                />
                @if (error('newCustomer.email'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="client-telephone">Téléphone (facultatif)</label>
                <input
                  id="client-telephone"
                  type="tel"
                  class="field-control"
                  autocomplete="off"
                  [attr.aria-invalid]="error('newCustomer.phone') ? true : null"
                  [value]="customer().phone"
                  (input)="patchCustomer({ phone: valueOf($event) })"
                />
                @if (error('newCustomer.phone'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="client-langue">Langue des e-mails</label>
                <select id="client-langue" class="field-control" (change)="languageOf($event)">
                  <option value="fr" [selected]="customer().preferredLanguage === 'fr'">
                    Français
                  </option>
                  <option value="en" [selected]="customer().preferredLanguage === 'en'">
                    Anglais
                  </option>
                </select>
              </div>
            </div>
          }
        </section>

        <section class="card flex flex-col gap-4 p-5" aria-labelledby="titre-recapitulatif">
          <h2 id="titre-recapitulatif" class="text-lg font-semibold">3. Récapitulatif</h2>
          <fieldset class="flex flex-wrap gap-x-6">
            <legend class="mb-2 text-sm font-semibold">Origine</legend>
            <label class="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="origine"
                class="size-5 accent-port"
                [checked]="source() === 'phone'"
                (change)="source.set('phone')"
              />
              Téléphone
            </label>
            <label class="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="origine"
                class="size-5 accent-port"
                [checked]="source() === 'desk'"
                (change)="source.set('desk')"
              />
              Comptoir
            </label>
          </fieldset>

          @if (services().length > 0) {
            <fieldset class="flex flex-col gap-1">
              <legend class="mb-2 text-sm font-semibold">Prestations</legend>
              @for (service of services(); track service.id) {
                <label class="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    class="size-5 accent-port"
                    [checked]="isChosen(service)"
                    (change)="toggleService(service)"
                  />
                  {{ serviceText(service) }}
                </label>
              }
            </fieldset>
          }

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="nouvelle-notes">Notes internes</label>
              <textarea
                id="nouvelle-notes"
                class="field-control h-20 py-2"
                [value]="internalNotes()"
                (input)="internalNotes.set(valueOf($event))"
              ></textarea>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="nouvelle-demande">Demande du client</label>
              <textarea
                id="nouvelle-demande"
                class="field-control h-20 py-2"
                [value]="customerMessage()"
                (input)="customerMessage.set(valueOf($event))"
              ></textarea>
            </div>
          </div>

          @if (totals(); as total) {
            <dl class="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt>Chambres</dt>
              <dd class="text-right">{{ euros(total.roomsCents) }}</dd>
              @if (total.servicesCents > 0) {
                <dt>Prestations</dt>
                <dd class="text-right">{{ euros(total.servicesCents) }}</dd>
              }
              @if (total.touristTaxCents > 0) {
                <dt>Taxe de séjour</dt>
                <dd class="text-right">{{ euros(total.touristTaxCents) }}</dd>
              }
              <dt class="border-t border-line pt-1 font-semibold">Total</dt>
              <dd class="border-t border-line pt-1 text-right font-semibold">
                {{ euros(total.totalCents) }}
              </dd>
            </dl>
          } @else {
            <p class="text-sm text-muted">Choisissez une catégorie pour chaque chambre.</p>
          }

          @if (createProblem(); as problem) {
            @if (problem.errors.length === 0) {
              <div class="alert-error" role="alert">
                <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                <p>
                  <span class="font-semibold">{{ problem.title }}.</span> {{ problem.detail }}
                </p>
              </div>
            } @else {
              <ul class="field-error list-inside list-disc" role="alert">
                @for (item of problem.errors; track $index) {
                  <li>{{ item.message }}</li>
                }
              </ul>
            }
          }

          <button type="submit" class="self-end btn-primary" [disabled]="saving() || !ready()">
            Créer la réservation
          </button>
        </section>
      }
    </form>
  `,
})
export class NewReservationPage {
  private readonly api = inject(ReservationApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);

  /**
   * Kept while the answer is unknown (network cut): a retry creates nothing more. Renewed after
   * a refusal of the API, since the corrected form is another request.
   */
  private key = crypto.randomUUID();

  protected readonly maxRooms = MAX_ROOMS;
  protected readonly adultChoices = ADULT_CHOICES;

  protected readonly stay = signal<StayDraft>({
    checkIn: hotelDay(0),
    checkOut: hotelDay(1),
    rooms: [{ adults: 2, ages: '', babyCot: false }],
  });
  protected readonly availability = signal<AvailabilityAnswer | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchProblem = signal<Problem | null>(null);
  protected readonly localErrors = signal<Record<string, string>>({});
  /** The category chosen for each requested room. */
  protected readonly choices = signal<(string | null)[]>([]);
  protected readonly ratePlan = signal<RatePlan>('flexible');

  protected readonly customerMode = signal<'existing' | 'new'>('new');
  protected readonly customerQuery = signal('');
  protected readonly customerResults = signal<CustomerChoice[] | null>(null);
  protected readonly chosenCustomer = signal<CustomerChoice | null>(null);
  protected readonly customer = signal<CustomerDraft>(EMPTY_CUSTOMER);

  protected readonly source = signal<'phone' | 'desk'>('phone');
  protected readonly services = signal<HotelService[]>([]);
  protected readonly chosenServices = signal<string[]>([]);
  protected readonly internalNotes = signal('');
  protected readonly customerMessage = signal('');

  protected readonly saving = signal(false);
  protected readonly createProblem = signal<Problem | null>(null);

  protected readonly totals = computed(() => {
    const answer = this.availability();
    if (answer === null) {
      return null;
    }
    const rooms = roomsTotal(answer, this.choices(), this.ratePlan());
    if (rooms === null) {
      return null;
    }
    const servicesCents = this.services()
      .filter((service) => this.chosenServices().includes(service.id))
      .reduce((sum, service) => {
        const quantity = serviceQuantity(service.pricingUnit, answer.rooms, answer.nights, 1);
        return sum + quantity * service.unitPriceCents;
      }, 0);
    const totalCents = rooms.roomsCents + servicesCents + rooms.touristTaxCents;
    return { ...rooms, servicesCents, totalCents };
  });

  protected readonly ready = computed(() => {
    const customerReady = this.customerMode() === 'new' || this.chosenCustomer() !== null;
    return this.totals() !== null && customerReady;
  });

  constructor() {
    void this.loadServices();
  }

  private async loadServices(): Promise<void> {
    try {
      const all = await this.catalog.services();
      this.services.set(all.filter((service) => service.isActive));
    } catch {
      // Without the list, the booking is still possible; services can be added later.
      this.services.set([]);
    }
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected numberOf(event: Event): number {
    return Number(this.valueOf(event));
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }

  protected error(field: string): string | undefined {
    return this.localErrors()[field] ?? fieldMessage(this.createProblem(), field);
  }

  // --- Stay ---

  /** Any change of the stay asks for the availability again. */
  protected patchStay(changes: Partial<StayDraft>): void {
    this.stay.update((stay) => ({ ...stay, ...changes }));
    this.availability.set(null);
  }

  protected patchRoom(index: number, changes: Partial<RoomDraft>): void {
    this.stay.update((stay) => {
      const rooms = stay.rooms.map((room, position) => {
        return position === index ? { ...room, ...changes } : room;
      });
      return { ...stay, rooms };
    });
    this.availability.set(null);
  }

  protected addRoom(): void {
    const rooms = [...this.stay().rooms, { adults: 2, ages: '', babyCot: false }];
    this.patchStay({ rooms });
  }

  protected removeRoom(index: number): void {
    const rooms = this.stay().rooms.filter((_, position) => position !== index);
    this.patchStay({ rooms });
  }

  /** The rooms as the API reads them; undefined (with the errors shown) when an age is wrong. */
  private occupancies(): Occupancy[] | undefined {
    const errors: Record<string, string> = {};
    const rooms = this.stay().rooms.map((room, index) => {
      const ages = parseAges(room.ages);
      if (ages === null) {
        errors[`rooms[${index}]`] = 'Âges de 0 à 17 ans, 3 enfants au plus : « 6, 3 ».';
      }
      return { adults: room.adults, childrenAges: ages ?? [] };
    });
    this.localErrors.set(errors);
    return Object.keys(errors).length > 0 ? undefined : rooms;
  }

  protected async search(): Promise<void> {
    const rooms = this.occupancies();
    if (rooms === undefined) {
      return;
    }
    const { checkIn, checkOut } = this.stay();
    this.searching.set(true);
    this.searchProblem.set(null);
    this.createProblem.set(null);
    try {
      const answer = await this.api.availability(checkIn, checkOut, rooms);
      this.availability.set(answer);
      this.choices.set(answer.rooms.map(() => null));
    } catch (error) {
      const problem = toProblem(error);
      this.searchProblem.set(problem);
      // Field errors of the API (dates…) are shown under their field.
      const errors: Record<string, string> = {};
      for (const item of problem.errors) {
        errors[item.field] = item.message;
      }
      this.localErrors.set(errors);
    } finally {
      this.searching.set(false);
    }
  }

  protected reason(category: CategoryAvailability, index: number): string | null {
    return unavailableReason(category, index);
  }

  /** « 315,00 € · 12 libres », or why it cannot be chosen. */
  protected offerText(category: CategoryAvailability, index: number): string {
    const reason = unavailableReason(category, index);
    if (reason !== null) {
      return `· ${reason}`;
    }
    const price = roomPrice(category.offers[index], this.ratePlan()) ?? 0;
    const free = category.freeRooms === 1 ? '1 libre' : `${category.freeRooms} libres`;
    return `· ${formatEuros(price)} · ${free}`;
  }

  protected roomLegend(room: Occupancy, index: number): string {
    return `Chambre ${index + 1} · ${guestsText(room)}`;
  }

  protected choose(index: number, categoryId: string): void {
    this.choices.update((choices) => {
      return choices.map((choice, position) => (position === index ? categoryId : choice));
    });
  }

  // --- Customer ---

  protected async searchCustomers(): Promise<void> {
    const text = this.customerQuery().trim();
    if (text.length < 2) {
      this.customerResults.set(null);
      return;
    }
    try {
      this.customerResults.set(await this.api.customers(text));
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    }
  }

  protected customerText(customer: CustomerChoice): string {
    const phone = customer.phone === null ? '' : ` · ${customer.phone}`;
    return `${customer.lastName} ${customer.firstName} · ${customer.email}${phone}`;
  }

  protected patchCustomer(changes: Partial<CustomerDraft>): void {
    this.customer.update((customer) => ({ ...customer, ...changes }));
  }

  protected languageOf(event: Event): void {
    this.patchCustomer({ preferredLanguage: this.valueOf(event) === 'en' ? 'en' : 'fr' });
  }

  // --- Summary ---

  protected isChosen(service: HotelService): boolean {
    return this.chosenServices().includes(service.id);
  }

  protected toggleService(service: HotelService): void {
    this.chosenServices.update((ids) => {
      const others = ids.filter((id) => id !== service.id);
      return others.length < ids.length ? others : [...ids, service.id];
    });
  }

  protected serviceText(service: HotelService): string {
    return `${service.name.fr} · ${formatEuros(service.unitPriceCents)}`;
  }

  /** What the API receives; undefined while something is missing. */
  private booking(): NewBooking | undefined {
    const answer = this.availability();
    const rooms = this.occupancies();
    if (answer === null || rooms === undefined) {
      return undefined;
    }
    const categoryIds = this.choices();
    const booking: NewBooking = {
      checkIn: answer.checkIn,
      checkOut: answer.checkOut,
      ratePlan: this.ratePlan(),
      source: this.source(),
      rooms: rooms.map((room, index) => ({
        categoryId: categoryIds[index] ?? '',
        adults: room.adults,
        childrenAges: room.childrenAges,
        babyCot: this.stay().rooms[index]?.babyCot ?? false,
      })),
      services: this.chosenServices().map((serviceId) => ({ serviceId, quantity: 1 })),
    };
    const chosen = this.chosenCustomer();
    if (this.customerMode() === 'existing' && chosen !== null) {
      booking.customerId = chosen.id;
    } else {
      const customer = this.customer();
      const phone = customer.phone.trim();
      booking.newCustomer = {
        firstName: customer.firstName.trim(),
        lastName: customer.lastName.trim(),
        email: customer.email.trim(),
        ...(phone === '' ? {} : { phone }),
        preferredLanguage: customer.preferredLanguage,
      };
    }
    const notes = this.internalNotes().trim();
    const message = this.customerMessage().trim();
    if (notes !== '') {
      booking.internalNotes = notes;
    }
    if (message !== '') {
      booking.customerMessage = message;
    }
    return booking;
  }

  protected async create(): Promise<void> {
    if (!this.ready()) {
      return;
    }
    const booking = this.booking();
    if (booking === undefined) {
      return;
    }
    this.saving.set(true);
    this.createProblem.set(null);
    try {
      const created = await this.api.create(booking, this.key);
      this.notifier.success(`Réservation ${created.reference} créée.`);
      await this.router.navigate(['/reservations', created.id]);
    } catch (error) {
      const problem = toProblem(error);
      if (problem.status !== 0) {
        this.key = crypto.randomUUID();
      }
      this.createProblem.set(problem);
    } finally {
      this.saving.set(false);
    }
  }
}
