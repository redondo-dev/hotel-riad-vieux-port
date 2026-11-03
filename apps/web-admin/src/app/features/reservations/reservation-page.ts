import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  type OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleAlert, LucidePencil, LucideX } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { ReservationApi, type ReservationChanges } from './reservation-api';
import {
  canAssignRoom,
  canCancel,
  canChangeStay,
  type CancellationQuote,
  type ChangePreview,
  type Charge,
  customerName,
  formatDateTime,
  formatDay,
  formatDifference,
  formatEuros,
  type FreeRoom,
  guestsText,
  isManagement,
  type Night,
  parseAges,
  PAYMENT_LABELS,
  paymentBadge,
  RATE_PLAN_LABELS,
  type ReservationDetail,
  type ReservationRoom,
  SOURCE_LABELS,
  STATUS_LABELS,
  statusBadge,
  stayText,
} from './reservation-model';

/** One booked room as the change form edits it (texts, as typed). */
interface RoomDraft {
  lineId: string;
  label: string;
  adults: number;
  ages: string;
  babyCot: boolean;
}

interface Draft {
  checkIn: string;
  checkOut: string;
  rooms: RoomDraft[];
  internalNotes: string;
  customerMessage: string;
  reason: string;
}

function draftOf(detail: ReservationDetail): Draft {
  return {
    checkIn: detail.checkIn,
    checkOut: detail.checkOut,
    rooms: detail.rooms.map((room) => ({
      lineId: room.id,
      label: `${room.category.name} · ${room.room?.number ?? 'à attribuer'}`,
      adults: room.adults,
      ages: room.childrenAges.join(', '),
      babyCot: room.babyCot,
    })),
    internalNotes: detail.internalNotes ?? '',
    customerMessage: detail.customerMessage ?? '',
    reason: '',
  };
}

const ADULT_CHOICES = [1, 2, 3, 4] as const;
const CLOSED_STATUSES = new Set(['cancelled', 'expired', 'no_show']);

/**
 * One reservation (UI/UX specification, section 5.D): customer, stay with each room and the
 * price of each night, services and tourist tax, notes; and the actions of the role — change
 * the dates, guests or notes (new price shown before saving), give a room, cancel. A change
 * made meanwhile by a colleague is refused by the API (412): the form keeps what was typed
 * and offers to reload.
 */
@Component({
  selector: 'adm-reservation-page',
  imports: [RouterLink, LucideArrowLeft, LucideCircleAlert, LucidePencil, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/reservations" class="mb-4 -ml-3 btn-quiet">
      <svg lucideArrowLeft></svg>
      Retour aux réservations
    </a>

    @if (loadProblem(); as error) {
      <div class="alert-error" role="alert">
        <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
        <p>
          <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
        </p>
      </div>
    } @else if (reservation(); as current) {
      <div class="flex max-w-4xl flex-col gap-4">
        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-reservation">
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-semibold">{{ current.reference }}</span>
            <span [class]="statusClass()">{{ statusLabel() }}</span>
            <span [class]="paymentClass()">{{ paymentLabel() }}</span>
            <span class="badge-neutral">{{ sourceLabel() }}</span>
            <span class="badge-neutral">{{ ratePlanLabel() }}</span>
          </p>
          <h2 id="titre-reservation" class="text-xl font-semibold">{{ name() }}</h2>
          <p>{{ stay() }}</p>
          @if (!closed()) {
            <div class="flex flex-wrap gap-2 pt-1">
              <button type="button" class="btn-secondary" (click)="openChange()">
                <svg lucidePencil></svg>
                Modifier
              </button>
              @if (cancellable()) {
                <button type="button" class="btn-danger" (click)="openCancel()">
                  <svg lucideX></svg>
                  Annuler la réservation
                </button>
              }
            </div>
          }
        </section>

        @if (current.cancelledAt; as cancelledAt) {
          <div class="alert-info" role="note">
            <p>{{ cancelledText(cancelledAt) }}</p>
          </div>
        }

        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-client">
          <h3 id="titre-client" class="font-semibold">Client</h3>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="text-muted">Nom</dt>
            <dd>{{ current.customer.firstName }} {{ current.customer.lastName }}</dd>
            <dt class="text-muted">E-mail</dt>
            <dd>
              <a class="text-port hover:underline" [href]="'mailto:' + current.customer.email">
                {{ current.customer.email }}
              </a>
            </dd>
            <dt class="text-muted">Téléphone</dt>
            <dd>{{ current.customer.phone ?? '—' }}</dd>
            <dt class="text-muted">Langue</dt>
            <dd>{{ current.customer.preferredLanguage === 'en' ? 'Anglais' : 'Français' }}</dd>
          </dl>
        </section>

        <section class="card flex flex-col gap-4 p-5" aria-labelledby="titre-sejour">
          <h3 id="titre-sejour" class="font-semibold">Séjour</h3>
          @for (room of current.rooms; track room.id) {
            <div class="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold">{{ roomTitle(room) }}</p>
                @if (room.room === null) {
                  <span class="badge-warning">À attribuer</span>
                }
                <span class="mr-auto"></span>
                @if (roomsEditable()) {
                  <button type="button" class="btn-quiet" (click)="openRoom(room)">
                    {{ room.room === null ? 'Attribuer une chambre' : 'Changer de chambre' }}
                  </button>
                }
              </div>
              <p class="text-sm">{{ guests(room) }}</p>
              <table class="w-full max-w-md text-left text-sm">
                <caption class="sr-only">
                  Prix des nuits
                </caption>
                <tbody>
                  @for (night of room.nights; track night.night) {
                    <tr class="border-b border-line last:border-0">
                      <th scope="row" class="py-1 pr-4 font-normal">{{ nightLabel(night) }}</th>
                      <td class="py-1 pr-4 text-muted">{{ night.rateLabel ?? '' }}</td>
                      <td class="py-1 text-right">{{ euros(night.priceCents) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-montants">
          <h3 id="titre-montants" class="font-semibold">Montants</h3>
          <dl class="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            @for (room of current.rooms; track room.id) {
              <dt>{{ room.category.name }} ({{ room.nights.length }} nuit(s))</dt>
              <dd class="text-right">{{ euros(room.subtotalCents) }}</dd>
            }
            @for (charge of current.charges; track charge.id) {
              <dt>{{ chargeLabel(charge) }}</dt>
              <dd class="text-right">{{ euros(charge.totalCents) }}</dd>
            }
            <dt class="border-t border-line pt-1 font-semibold">Total</dt>
            <dd class="border-t border-line pt-1 text-right font-semibold">
              {{ euros(current.totalCents) }}
            </dd>
          </dl>
          <p class="text-sm text-muted">{{ cancellationText() }}</p>
        </section>

        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-notes">
          <h3 id="titre-notes" class="font-semibold">Notes</h3>
          <dl class="flex flex-col gap-2 text-sm">
            <dt class="text-muted">Notes internes</dt>
            <dd class="whitespace-pre-line">{{ current.internalNotes ?? 'Aucune.' }}</dd>
            <dt class="text-muted">Demande du client</dt>
            <dd class="whitespace-pre-line">{{ current.customerMessage ?? 'Aucune.' }}</dd>
          </dl>
          <p class="text-sm text-muted">{{ createdText() }}</p>
        </section>
      </div>

      <!-- Change: dates, guests, notes -->
      <dialog
        #changeDialog
        class="dialog-panel max-w-2xl"
        aria-labelledby="titre-modification"
        (close)="changeProblem.set(null)"
      >
        <form class="flex flex-col gap-5 p-6" novalidate (submit)="$event.preventDefault(); next()">
          <h2 id="titre-modification" class="text-lg font-semibold">
            Modifier {{ current.reference }}
          </h2>
          @if (conflict(); as error) {
            <div class="alert-error" role="alert">
              <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
              <div>
                <p>{{ error.detail }}</p>
                <p>Votre saisie est conservée.</p>
                <button type="button" class="-ml-3 btn-quiet" (click)="reload()">Recharger</button>
              </div>
            </div>
          } @else if (changeProblem(); as error) {
            @if (error.errors.length === 0) {
              <div class="alert-error" role="alert">
                <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                <p>
                  <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
                </p>
              </div>
            }
          }

          @if (stayEditable()) {
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="modif-arrivee">Arrivée</label>
                <input
                  id="modif-arrivee"
                  type="date"
                  class="field-control"
                  [attr.aria-invalid]="error('checkIn') ? true : null"
                  [value]="draft().checkIn"
                  (change)="patch({ checkIn: valueOf($event) })"
                />
                @if (error('checkIn'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="modif-depart">Départ</label>
                <input
                  id="modif-depart"
                  type="date"
                  class="field-control"
                  [attr.aria-invalid]="error('checkOut') ? true : null"
                  [value]="draft().checkOut"
                  (change)="patch({ checkOut: valueOf($event) })"
                />
                @if (error('checkOut'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
            </div>
            @for (room of draft().rooms; track room.lineId; let index = $index) {
              <fieldset class="flex flex-col gap-3 rounded-lg border border-line p-4">
                <legend class="px-1 text-sm font-semibold">{{ room.label }}</legend>
                <div class="flex flex-wrap items-end gap-3">
                  <div class="flex flex-col gap-1.5">
                    <label class="field-label" [for]="'modif-adultes-' + index">Adultes</label>
                    <select
                      class="field-control w-24"
                      [id]="'modif-adultes-' + index"
                      (change)="patchRoom(index, { adults: numberOf($event) })"
                    >
                      @for (count of adultChoices; track count) {
                        <option [value]="count" [selected]="room.adults === count">
                          {{ count }}
                        </option>
                      }
                    </select>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label class="field-label" [for]="'modif-ages-' + index">
                      Âges des enfants
                    </label>
                    <input
                      class="field-control w-40"
                      autocomplete="off"
                      placeholder="6, 3"
                      [id]="'modif-ages-' + index"
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
                </div>
                @if (error('rooms[' + index + ']'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </fieldset>
            }
            @if (current.ratePlan === 'non_refundable') {
              <div class="flex flex-col gap-1.5">
                <label class="field-label" for="modif-motif">Motif (tarif non remboursable)</label>
                <input
                  id="modif-motif"
                  class="field-control"
                  autocomplete="off"
                  placeholder="Geste commercial"
                  [attr.aria-invalid]="error('reason') ? true : null"
                  [value]="draft().reason"
                  (input)="patch({ reason: valueOf($event) })"
                />
                @if (error('reason'); as message) {
                  <p class="field-error">{{ message }}</p>
                }
              </div>
            }
          } @else {
            <p class="alert-info">{{ stayLockedText() }}</p>
          }

          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="modif-notes">Notes internes</label>
            <textarea
              id="modif-notes"
              class="field-control h-20 py-2"
              [value]="draft().internalNotes"
              (input)="patch({ internalNotes: valueOf($event) })"
            ></textarea>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="modif-demande">Demande du client</label>
            <textarea
              id="modif-demande"
              class="field-control h-20 py-2"
              [value]="draft().customerMessage"
              (input)="patch({ customerMessage: valueOf($event) })"
            ></textarea>
          </div>

          @if (preview(); as price) {
            <p class="alert-info font-semibold" role="status">{{ previewText(price) }}</p>
          }

          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="changeDialog.close()">Retour</button>
            <button type="submit" class="btn-primary" [disabled]="saving() || !dirty()">
              {{ needsPreview() ? 'Voir le nouveau prix' : 'Enregistrer' }}
            </button>
          </div>
        </form>
      </dialog>

      <!-- Room given to one booked room -->
      <dialog
        #roomDialog
        class="dialog-panel"
        aria-labelledby="titre-chambre"
        (close)="roomProblem.set(null)"
      >
        @if (roomLine(); as line) {
          <form
            class="flex flex-col gap-4 p-6"
            novalidate
            (submit)="$event.preventDefault(); giveRoom(line)"
          >
            <h2 id="titre-chambre" class="text-lg font-semibold">
              Chambre : {{ line.category.name }}
            </h2>
            @if (roomProblem(); as error) {
              <div class="alert-error" role="alert">
                <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                <p>
                  <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
                </p>
              </div>
            }
            @if (freeRooms() === null) {
              <p class="text-muted" role="status">Recherche des chambres libres…</p>
            } @else {
              <fieldset class="flex flex-col gap-1">
                <legend class="mb-2 text-sm text-muted">
                  Chambres libres et en service sur tout le séjour
                </legend>
                @for (free of freeRooms(); track free.id) {
                  <label class="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="chambre"
                      class="size-5 accent-port"
                      [checked]="chosenRoom() === free.id"
                      (change)="chosenRoom.set(free.id)"
                    />
                    {{ freeRoomText(free) }}
                  </label>
                } @empty {
                  <p class="text-sm">Aucune chambre libre et en service sur tout le séjour.</p>
                }
                @if (line.room !== null) {
                  <label class="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="chambre"
                      class="size-5 accent-port"
                      [checked]="chosenRoom() === ''"
                      (change)="chosenRoom.set('')"
                    />
                    Retirer la chambre (à attribuer plus tard)
                  </label>
                }
              </fieldset>
            }
            <div class="flex flex-wrap justify-end gap-3">
              <button type="button" class="btn-quiet" (click)="roomDialog.close()">Retour</button>
              <button type="submit" class="btn-primary" [disabled]="saving() || !roomChanged()">
                Enregistrer
              </button>
            </div>
          </form>
        }
      </dialog>

      <!-- Cancellation -->
      <dialog
        #cancelDialog
        class="dialog-panel"
        aria-labelledby="titre-annulation"
        (close)="cancelProblem.set(null)"
      >
        <form
          class="flex flex-col gap-4 p-6"
          novalidate
          (submit)="$event.preventDefault(); cancel()"
        >
          <h2 id="titre-annulation" class="text-lg font-semibold text-danger">
            Annuler {{ current.reference }} ?
          </h2>
          @if (cancelProblem(); as error) {
            @if (error.errors.length === 0) {
              <div class="alert-error" role="alert">
                <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                <p>
                  <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
                </p>
              </div>
            }
          }
          @if (quote(); as fee) {
            <p class="alert-error">{{ quoteText(fee) }}</p>
          } @else {
            <p class="text-muted" role="status">Calcul des frais…</p>
          }
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="annulation-motif">Motif</label>
            <textarea
              id="annulation-motif"
              class="field-control h-20 py-2"
              [attr.aria-invalid]="cancelError('reason') ? true : null"
              [value]="cancelReason()"
              (input)="cancelReason.set(valueOf($event))"
            ></textarea>
            @if (cancelError('reason'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          @if (management()) {
            <label class="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                class="size-5 accent-port"
                [checked]="waiveFee()"
                (change)="waiveFee.set(!waiveFee())"
              />
              Renoncer aux frais (geste commercial)
            </label>
          }
          <p class="text-sm text-muted">Les chambres sont libérées aussitôt.</p>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="cancelDialog.close()">Retour</button>
            <button
              type="submit"
              class="btn-danger"
              [disabled]="saving() || cancelReason().trim() === '' || quote() === null"
            >
              Annuler la réservation
            </button>
          </div>
        </form>
      </dialog>
    } @else {
      <p class="text-muted" role="status">Chargement de la réservation…</p>
    }
  `,
})
export class ReservationPage implements OnInit {
  private readonly api = inject(ReservationApi);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);
  private readonly changeDialog = viewChild<ElementRef<HTMLDialogElement>>('changeDialog');
  private readonly roomDialog = viewChild<ElementRef<HTMLDialogElement>>('roomDialog');
  private readonly cancelDialog = viewChild<ElementRef<HTMLDialogElement>>('cancelDialog');

  /** From the address /reservations/:id. */
  readonly id = input.required<string>();

  private readonly role = computed(() => this.session.user()?.role);

  protected readonly adultChoices = ADULT_CHOICES;
  protected readonly reservation = signal<ReservationDetail | null>(null);
  protected readonly loadProblem = signal<Problem | null>(null);
  protected readonly saving = signal(false);

  protected readonly management = computed(() => isManagement(this.role()));
  protected readonly closed = computed(() => {
    const current = this.reservation();
    return current === null || CLOSED_STATUSES.has(current.status);
  });
  protected readonly cancellable = computed(() => {
    const current = this.reservation();
    return current !== null && canCancel(current, this.role());
  });
  protected readonly stayEditable = computed(() => {
    const current = this.reservation();
    return current !== null && canChangeStay(current, this.role());
  });
  protected readonly roomsEditable = computed(() => {
    const current = this.reservation();
    return current !== null && canAssignRoom(current);
  });

  protected readonly name = computed(() => {
    const current = this.reservation();
    return current === null ? '' : customerName(current.customer);
  });
  protected readonly stay = computed(() => {
    const current = this.reservation();
    return current === null ? '' : stayText(current.checkIn, current.checkOut, current.nights);
  });
  protected readonly statusLabel = computed(() => {
    const current = this.reservation();
    return current === null ? '' : STATUS_LABELS[current.status];
  });
  protected readonly statusClass = computed(() => {
    const current = this.reservation();
    return current === null ? '' : statusBadge(current.status);
  });
  protected readonly paymentLabel = computed(() => {
    const current = this.reservation();
    return current === null ? '' : PAYMENT_LABELS[current.paymentStatus];
  });
  protected readonly paymentClass = computed(() => {
    const current = this.reservation();
    return current === null ? '' : paymentBadge(current.paymentStatus);
  });
  protected readonly sourceLabel = computed(() => {
    const current = this.reservation();
    return current === null ? '' : SOURCE_LABELS[current.source];
  });
  protected readonly ratePlanLabel = computed(() => {
    const current = this.reservation();
    return current === null ? '' : RATE_PLAN_LABELS[current.ratePlan];
  });
  protected readonly cancellationText = computed(() => {
    const current = this.reservation();
    if (current === null || current.ratePlan === 'non_refundable') {
      return 'Tarif non remboursable : aucune annulation gratuite.';
    }
    const until = current.freeCancellationUntil;
    return until === null ? '' : `Annulation gratuite jusqu’au ${formatDateTime(until)}.`;
  });
  protected readonly feeText = computed(() => {
    const fee = this.reservation()?.cancellationFeeCents ?? 0;
    return fee === 0 ? 'Sans frais.' : `Frais à encaisser : ${formatEuros(fee)}.`;
  });
  protected readonly createdText = computed(() => {
    const current = this.reservation();
    if (current === null) {
      return '';
    }
    const by = current.createdBy;
    const who = by === null ? '' : ` par ${by.firstName} ${by.lastName}`;
    return `Créée le ${formatDateTime(current.createdAt)}${who}.`;
  });
  protected readonly stayLockedText = computed(() => {
    const current = this.reservation();
    if (current?.ratePlan === 'non_refundable' && current.status === 'confirmed') {
      return 'Tarif non remboursable : seule la direction peut changer les dates ou les voyageurs.';
    }
    return 'Les dates et les voyageurs ne changent plus à ce stade ; les notes, si.';
  });

  // --- Change form ---
  protected readonly draft = signal<Draft>({
    checkIn: '',
    checkOut: '',
    rooms: [],
    internalNotes: '',
    customerMessage: '',
    reason: '',
  });
  protected readonly preview = signal<ChangePreview | null>(null);
  protected readonly changeProblem = signal<Problem | null>(null);
  protected readonly localErrors = signal<Record<string, string>>({});
  /** Changed meanwhile by a colleague (412). */
  protected readonly conflict = signal<Problem | null>(null);

  /** The dates or the guests differ from the reservation: a new price is needed. */
  private readonly stayDirty = computed(() => {
    const current = this.reservation();
    if (current === null) {
      return false;
    }
    const draft = this.draft();
    const original = draftOf(current);
    const guests = (rooms: RoomDraft[]): string =>
      JSON.stringify(rooms.map((room) => [room.adults, parseAges(room.ages), room.babyCot]));
    return (
      draft.checkIn !== original.checkIn ||
      draft.checkOut !== original.checkOut ||
      guests(draft.rooms) !== guests(original.rooms)
    );
  });
  private readonly notesDirty = computed(() => {
    const current = this.reservation();
    if (current === null) {
      return false;
    }
    const draft = this.draft();
    return (
      draft.internalNotes.trim() !== (current.internalNotes ?? '') ||
      draft.customerMessage.trim() !== (current.customerMessage ?? '')
    );
  });
  protected readonly dirty = computed(() => this.stayDirty() || this.notesDirty());
  protected readonly needsPreview = computed(() => this.stayDirty() && this.preview() === null);

  // --- Room dialog ---
  protected readonly roomLine = signal<ReservationRoom | null>(null);
  protected readonly freeRooms = signal<FreeRoom[] | null>(null);
  protected readonly chosenRoom = signal('');
  protected readonly roomProblem = signal<Problem | null>(null);
  protected readonly roomChanged = computed(() => {
    const line = this.roomLine();
    return line !== null && this.chosenRoom() !== (line.room?.id ?? '');
  });

  // --- Cancel dialog ---
  protected readonly quote = signal<CancellationQuote | null>(null);
  protected readonly cancelReason = signal('');
  protected readonly waiveFee = signal(false);
  protected readonly cancelProblem = signal<Problem | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loadProblem.set(null);
    try {
      this.reservation.set(await this.api.detail(this.id()));
    } catch (error) {
      this.loadProblem.set(toProblem(error));
    }
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected numberOf(event: Event): number {
    return Number(this.valueOf(event));
  }

  /** « Nuit du 10 mai 2034 ». */
  protected nightLabel(night: Night): string {
    return `Nuit du ${formatDay(night.night)}`;
  }

  protected euros(cents: number): string {
    return formatEuros(cents);
  }

  /** « 2 adultes, 1 enfant (6 ans) · lit bébé ». */
  protected guests(room: ReservationRoom): string {
    return room.babyCot ? `${guestsText(room)} · lit bébé` : guestsText(room);
  }

  /** « Double standard · chambre 214 », or the category alone while the room is to assign. */
  protected roomTitle(room: ReservationRoom): string {
    const name = room.category.name;
    return room.room === null ? name : `${name} · chambre ${room.room.number}`;
  }

  /** « Nouveau total : 486,00 € (+162,00 €). » */
  protected previewText(price: ChangePreview): string {
    const difference = formatDifference(price.differenceCents);
    return `Nouveau total : ${formatEuros(price.totalCents)} (${difference}).`;
  }

  /** « Annulée le 3 novembre 2026 à 10:42. Motif : client malade. Frais à encaisser : 115 €. » */
  protected cancelledText(cancelledAt: string): string {
    const reason = this.reservation()?.cancellationReason ?? '';
    return `Annulée le ${formatDateTime(cancelledAt)}. Motif : ${reason}. ${this.feeText()}`;
  }

  /** « Petit-déjeuner × 6 », « Taxe de séjour × 4 ». */
  protected chargeLabel(charge: Charge): string {
    return charge.quantity === 1 ? charge.label : `${charge.label} × ${charge.quantity}`;
  }

  protected freeRoomText(room: FreeRoom): string {
    const clean = room.housekeepingStatus === 'clean' ? 'propre' : 'à nettoyer';
    return `Chambre ${room.number} · étage ${room.floor} · ${clean}`;
  }

  protected quoteText(quote: CancellationQuote): string {
    if (quote.feeCents === 0) {
      return 'Annulation sans frais.';
    }
    const why =
      this.reservation()?.ratePlan === 'non_refundable'
        ? 'tarif non remboursable, toutes les nuits restent dues'
        : 'délai d’annulation gratuite dépassé, la première nuit est due';
    return `Frais d’annulation : ${formatEuros(quote.feeCents)} (${why}).`;
  }

  protected error(field: string): string | undefined {
    return this.localErrors()[field] ?? fieldMessage(this.changeProblem(), field);
  }

  protected cancelError(field: string): string | undefined {
    return fieldMessage(this.cancelProblem(), field);
  }

  // --- Change ---

  protected openChange(): void {
    const current = this.reservation();
    if (current === null) {
      return;
    }
    this.draft.set(draftOf(current));
    this.preview.set(null);
    this.conflict.set(null);
    this.localErrors.set({});
    this.changeProblem.set(null);
    this.changeDialog()?.nativeElement.showModal();
  }

  /** Any change of what is typed asks for a new price before saving. */
  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
    this.preview.set(null);
  }

  protected patchRoom(index: number, changes: Partial<RoomDraft>): void {
    this.draft.update((draft) => {
      const rooms = draft.rooms.map((room, position) => {
        return position === index ? { ...room, ...changes } : room;
      });
      return { ...draft, rooms };
    });
    this.preview.set(null);
  }

  /** What the API receives: only what changed; undefined when an age is not valid. */
  private changes(): ReservationChanges | undefined {
    const current = this.reservation();
    if (current === null) {
      return undefined;
    }
    const draft = this.draft();
    const original = draftOf(current);
    const changes: ReservationChanges = {};
    const errors: Record<string, string> = {};
    if (this.stayDirty()) {
      if (draft.checkIn !== original.checkIn) {
        changes.checkIn = draft.checkIn;
      }
      if (draft.checkOut !== original.checkOut) {
        changes.checkOut = draft.checkOut;
      }
      changes.rooms = draft.rooms.map((room, index) => {
        const ages = parseAges(room.ages);
        if (ages === null) {
          errors[`rooms[${index}]`] = 'Âges de 0 à 17 ans, 3 enfants au plus : « 6, 3 ».';
        }
        return {
          lineId: room.lineId,
          adults: room.adults,
          childrenAges: ages ?? [],
          babyCot: room.babyCot,
        };
      });
      if (draft.reason.trim() !== '') {
        changes.reason = draft.reason.trim();
      }
    }
    if (draft.internalNotes.trim() !== (current.internalNotes ?? '')) {
      changes.internalNotes = draft.internalNotes.trim() || null;
    }
    if (draft.customerMessage.trim() !== (current.customerMessage ?? '')) {
      changes.customerMessage = draft.customerMessage.trim() || null;
    }
    this.localErrors.set(errors);
    return Object.keys(errors).length > 0 ? undefined : changes;
  }

  /** First the new price when the stay changes, then the saving. */
  protected async next(): Promise<void> {
    const current = this.reservation();
    const changes = this.changes();
    if (current === null || changes === undefined) {
      return;
    }
    this.saving.set(true);
    this.changeProblem.set(null);
    try {
      if (this.needsPreview()) {
        this.preview.set(await this.api.preview(current.id, current.version, changes));
      } else {
        const updated = await this.api.change(current.id, current.version, changes);
        this.reservation.set(updated);
        this.changeDialog()?.nativeElement.close();
        this.notifier.success(`${updated.reference} : modification enregistrée.`);
      }
    } catch (error) {
      const problem = toProblem(error);
      if (problem.status === 412) {
        this.conflict.set(problem);
      } else {
        this.changeProblem.set(problem);
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** After a 412: the reservation as it is now; what was typed stays in the form. */
  protected async reload(): Promise<void> {
    await this.load();
    this.conflict.set(null);
    this.preview.set(null);
  }

  // --- Room ---

  protected async openRoom(line: ReservationRoom): Promise<void> {
    const current = this.reservation();
    if (current === null) {
      return;
    }
    this.roomLine.set(line);
    this.chosenRoom.set(line.room?.id ?? '');
    this.freeRooms.set(null);
    this.roomProblem.set(null);
    this.roomDialog()?.nativeElement.showModal();
    try {
      this.freeRooms.set(await this.api.freeRooms(current.id, line.id));
    } catch (error) {
      this.freeRooms.set([]);
      this.roomProblem.set(toProblem(error));
    }
  }

  protected async giveRoom(line: ReservationRoom): Promise<void> {
    const current = this.reservation();
    if (current === null) {
      return;
    }
    this.saving.set(true);
    this.roomProblem.set(null);
    try {
      const roomId = this.chosenRoom() || null;
      const updated = await this.api.assignRoom(current.id, line.id, roomId);
      this.reservation.set(updated);
      this.roomDialog()?.nativeElement.close();
      this.notifier.success(roomId === null ? 'Chambre retirée.' : 'Chambre attribuée.');
    } catch (error) {
      this.roomProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  // --- Cancellation ---

  protected async openCancel(): Promise<void> {
    const current = this.reservation();
    if (current === null) {
      return;
    }
    this.quote.set(null);
    this.cancelReason.set('');
    this.waiveFee.set(false);
    this.cancelProblem.set(null);
    this.cancelDialog()?.nativeElement.showModal();
    try {
      this.quote.set(await this.api.cancellationQuote(current.id));
    } catch (error) {
      this.cancelProblem.set(toProblem(error));
    }
  }

  protected async cancel(): Promise<void> {
    const current = this.reservation();
    if (current === null) {
      return;
    }
    this.saving.set(true);
    this.cancelProblem.set(null);
    try {
      const reason = this.cancelReason().trim();
      const updated = await this.api.cancel(current.id, reason, this.waiveFee());
      this.reservation.set(updated);
      this.cancelDialog()?.nativeElement.close();
      this.notifier.success(`${updated.reference} : réservation annulée.`);
    } catch (error) {
      this.cancelProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }
}
