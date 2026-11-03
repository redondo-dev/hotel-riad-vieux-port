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
import { LucideArrowLeft, LucideCircleAlert } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { daysBetween } from '../planning/planning-model';
import { stayText } from '../reservations/reservation-model';
import { IncidentApi } from './incident-api';
import {
  type AffectedStay,
  affectedTitle,
  assigneeText,
  canAssign,
  eventText,
  formatDateTime,
  fullName,
  type IncidentDetail,
  type IncidentEvent,
  movesGuests,
  type PersonName,
  placeOf,
  PRIORITY_LABELS,
  type StatusAction,
  statusActions,
  STATUS_LABELS,
} from './incident-model';

/**
 * One incident (UI/UX specification, section 5.H): what, where, who, its dated history, and
 * the actions this role may take — change of state (with an optional comment), assignment,
 * comment. Every action reloads the incident as the API returns it.
 */
@Component({
  selector: 'adm-incident-page',
  imports: [RouterLink, LucideArrowLeft, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/pannes" class="mb-4 -ml-3 btn-quiet">
      <svg lucideArrowLeft></svg>
      Retour aux pannes
    </a>

    @if (loadProblem(); as error) {
      <div class="alert-error" role="alert">
        <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
        <p>
          <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
        </p>
      </div>
    } @else if (incident(); as current) {
      <div class="flex max-w-3xl flex-col gap-4">
        @if (current.affectedStays.length > 0) {
          <div class="alert-error" role="alert">
            <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
            <div class="flex flex-col gap-1">
              <p class="font-semibold">{{ affected() }}</p>
              <ul>
                @for (stay of current.affectedStays; track stay.reservationId) {
                  <li>
                    @if (canMove()) {
                      <a
                        class="font-medium underline"
                        [routerLink]="['/reservations', stay.reservationId]"
                      >
                        {{ stay.reference }}
                      </a>
                    } @else {
                      <span class="font-medium">{{ stay.reference }}</span>
                    }
                    {{ stayDates(stay) }}
                  </li>
                }
              </ul>
            </div>
          </div>
        }
        <section class="card flex flex-col gap-3 p-5" [class.incident-urgent]="isUrgent()">
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted">{{ current.reference }}</span>
            <span [class]="isUrgent() ? 'badge-off' : 'badge-neutral'">{{ priority() }}</span>
            <span class="badge-neutral">{{ status() }}</span>
            @if (current.roomBlocked) {
              <span class="badge-off">Chambre hors service</span>
            }
          </p>
          <h2 class="text-xl font-semibold">{{ current.title }}</h2>
          <p class="whitespace-pre-line">{{ current.description }}</p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="text-muted">Lieu</dt>
            <dd>{{ place() }}</dd>
            <dt class="text-muted">Signalée</dt>
            <dd>{{ reported() }}</dd>
            <dt class="text-muted">Assignée à</dt>
            <dd>{{ assignee() }}</dd>
          </dl>
          @if (actions().length > 0 || assignable()) {
            <div class="flex flex-wrap gap-2 pt-2">
              @for (action of actions(); track action.to) {
                <button type="button" class="btn-primary" (click)="askStatus(action)">
                  {{ action.label }}
                </button>
              }
              @if (assignable()) {
                <button type="button" class="btn-secondary" (click)="openAssign()">Assigner</button>
              }
            </div>
          }
        </section>

        <section class="card flex flex-col gap-3 p-5" aria-labelledby="titre-historique">
          <h3 id="titre-historique" class="font-semibold">Historique</h3>
          <ol class="flex flex-col gap-3">
            @for (event of current.events; track event.id) {
              <li class="border-l-2 border-line pl-3">
                <p class="text-sm text-muted">{{ when(event.createdAt) }} · {{ actor(event) }}</p>
                <p class="font-medium">{{ eventLabel(event) }}</p>
                @if (event.comment) {
                  <p class="whitespace-pre-line">{{ event.comment }}</p>
                }
              </li>
            }
          </ol>
          @if (current.status !== 'closed') {
            <form
              class="flex flex-col gap-2 pt-2"
              novalidate
              (submit)="$event.preventDefault(); addComment()"
            >
              <label class="field-label" for="commentaire">Ajouter un commentaire</label>
              <textarea
                id="commentaire"
                class="field-control h-24 py-2"
                [attr.aria-invalid]="commentError() ? true : null"
                [value]="comment()"
                (input)="comment.set(valueOf($event))"
              ></textarea>
              @if (commentError(); as message) {
                <p class="field-error">{{ message }}</p>
              }
              <button
                type="submit"
                class="self-end btn-secondary"
                [disabled]="saving() || comment().trim() === ''"
              >
                Ajouter
              </button>
            </form>
          }
        </section>
      </div>

      <!-- Change of state, with an optional comment -->
      <dialog #statusDialog class="dialog-panel" aria-labelledby="titre-etat">
        @if (pendingAction(); as action) {
          <form
            class="flex flex-col gap-4 p-6"
            novalidate
            (submit)="$event.preventDefault(); confirmStatus(action)"
          >
            <h2 id="titre-etat" class="text-lg font-semibold">
              {{ action.label }} : {{ current.reference }}
            </h2>
            <div class="flex flex-col gap-1.5">
              <label class="field-label" for="etat-commentaire">Commentaire (facultatif)</label>
              <textarea
                id="etat-commentaire"
                class="field-control h-24 py-2"
                [value]="statusComment()"
                (input)="statusComment.set(valueOf($event))"
              ></textarea>
            </div>
            <div class="flex flex-wrap justify-end gap-3">
              <button type="button" class="btn-quiet" (click)="statusDialog.close()">Retour</button>
              <button type="submit" class="btn-primary" [disabled]="saving()">
                {{ action.label }}
              </button>
            </div>
          </form>
        }
      </dialog>

      <!-- Assignment -->
      <dialog
        #assignDialog
        class="dialog-panel"
        aria-labelledby="titre-assignation"
        (close)="assignProblem.set(null)"
      >
        <form
          class="flex flex-col gap-4 p-6"
          novalidate
          (submit)="$event.preventDefault(); confirmAssign()"
        >
          <h2 id="titre-assignation" class="text-lg font-semibold">Assigner la panne</h2>
          @if (assignProblem(); as error) {
            @if (error.errors.length === 0) {
              <div class="alert-error" role="alert">
                <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
                <p>
                  <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
                </p>
              </div>
            }
          }
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="assignation-technicien">Technicien</label>
            <select
              id="assignation-technicien"
              class="field-control"
              [attr.aria-invalid]="assignError('assignedTo') ? true : null"
              (change)="assignedTo.set(valueOf($event))"
            >
              <option value="" [selected]="assignedTo() === ''">Personne</option>
              @for (technician of technicians(); track technician.id) {
                <option [value]="technician.id" [selected]="assignedTo() === technician.id">
                  {{ name(technician) }}
                </option>
              }
            </select>
            @if (assignError('assignedTo'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="assignation-prestataire">
              Prestataire externe (facultatif)
            </label>
            <input
              id="assignation-prestataire"
              class="field-control"
              autocomplete="off"
              placeholder="Plomberie du Panier"
              [attr.aria-invalid]="assignError('externalContractor') ? true : null"
              [value]="contractor()"
              (input)="contractor.set(valueOf($event))"
            />
            @if (assignError('externalContractor'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="assignDialog.close()">Retour</button>
            <button type="submit" class="btn-primary" [disabled]="saving()">Enregistrer</button>
          </div>
        </form>
      </dialog>
    } @else {
      <p class="text-muted" role="status">Chargement de la panne…</p>
    }
  `,
})
export class IncidentPage implements OnInit {
  private readonly api = inject(IncidentApi);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);
  private readonly statusDialog = viewChild<ElementRef<HTMLDialogElement>>('statusDialog');
  private readonly assignDialog = viewChild<ElementRef<HTMLDialogElement>>('assignDialog');

  /** From the address /pannes/:id. */
  readonly id = input.required<string>();

  private readonly role = computed(() => this.session.user()?.role);

  protected readonly incident = signal<IncidentDetail | null>(null);
  protected readonly loadProblem = signal<Problem | null>(null);
  protected readonly saving = signal(false);

  protected readonly comment = signal('');
  protected readonly commentProblem = signal<Problem | null>(null);
  protected readonly pendingAction = signal<StatusAction | null>(null);
  protected readonly statusComment = signal('');

  protected readonly technicians = signal<PersonName[]>([]);
  protected readonly assignedTo = signal('');
  protected readonly contractor = signal('');
  protected readonly assignProblem = signal<Problem | null>(null);

  protected readonly isUrgent = computed(() => this.incident()?.priority === 'urgent');
  protected readonly canMove = computed(() => movesGuests(this.role()));
  protected readonly affected = computed(() => {
    const current = this.incident();
    if (current === null) {
      return '';
    }
    const room = current.room?.number ?? '';
    return affectedTitle(room, current.affectedStays.length, this.canMove());
  });
  protected readonly priority = computed(() => {
    const current = this.incident();
    return current === null ? '' : PRIORITY_LABELS[current.priority];
  });
  protected readonly status = computed(() => {
    const current = this.incident();
    return current === null ? '' : STATUS_LABELS[current.status];
  });
  protected readonly place = computed(() => {
    const current = this.incident();
    return current === null ? '' : placeOf(current);
  });
  protected readonly assignee = computed(() => {
    const current = this.incident();
    return current === null ? '' : assigneeText(current);
  });
  protected readonly reported = computed(() => {
    const current = this.incident();
    if (current === null) {
      return '';
    }
    return `${formatDateTime(current.reportedAt)} par ${fullName(current.reportedBy)}`;
  });
  protected readonly actions = computed(() => {
    const current = this.incident();
    return current === null ? [] : statusActions(current.status, this.role());
  });
  protected readonly assignable = computed(() => {
    const current = this.incident();
    return current !== null && canAssign(current.status, this.role());
  });
  protected readonly commentError = computed(() => {
    return fieldMessage(this.commentProblem(), 'comment');
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loadProblem.set(null);
    try {
      this.incident.set(await this.api.detail(this.id()));
    } catch (error) {
      this.loadProblem.set(toProblem(error));
    }
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  protected actor(event: IncidentEvent): string {
    return fullName(event.actor);
  }

  protected eventLabel(event: IncidentEvent): string {
    return eventText(event);
  }

  protected name(person: PersonName): string {
    return fullName(person);
  }

  protected assignError(field: string): string | undefined {
    return fieldMessage(this.assignProblem(), field);
  }

  // --- Change of state ---

  protected askStatus(action: StatusAction): void {
    this.pendingAction.set(action);
    this.statusComment.set('');
    this.statusDialog()?.nativeElement.showModal();
  }

  protected async confirmStatus(action: StatusAction): Promise<void> {
    const comment = this.statusComment().trim();
    this.saving.set(true);
    try {
      const updated = await this.api.changeStatus(this.id(), action.to, comment || null);
      this.incident.set(updated);
      this.notifier.success(`${updated.reference} : ${STATUS_LABELS[updated.status]}.`);
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.saving.set(false);
      this.statusDialog()?.nativeElement.close();
    }
  }

  // --- Assignment ---

  protected async openAssign(): Promise<void> {
    const current = this.incident();
    this.assignedTo.set(current?.assignedTo?.id ?? '');
    this.contractor.set(current?.externalContractor ?? '');
    this.assignProblem.set(null);
    this.assignDialog()?.nativeElement.showModal();
    if (this.technicians().length === 0) {
      try {
        this.technicians.set(await this.api.technicians());
      } catch (error) {
        this.assignProblem.set(toProblem(error));
      }
    }
  }

  protected async confirmAssign(): Promise<void> {
    const contractor = this.contractor().trim();
    this.saving.set(true);
    this.assignProblem.set(null);
    try {
      const updated = await this.api.assign(
        this.id(),
        this.assignedTo() || null,
        contractor || null,
      );
      this.incident.set(updated);
      this.notifier.success(`${updated.reference} : assignation enregistrée.`);
      this.assignDialog()?.nativeElement.close();
    } catch (error) {
      this.assignProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  // --- Comment ---

  protected async addComment(): Promise<void> {
    const comment = this.comment().trim();
    if (comment === '') {
      return;
    }
    this.saving.set(true);
    this.commentProblem.set(null);
    try {
      this.incident.set(await this.api.comment(this.id(), comment));
      this.comment.set('');
    } catch (error) {
      this.commentProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** « du 5 au 8 novembre 2026 · 3 nuits ». */
  protected stayDates(stay: AffectedStay): string {
    return stayText(stay.checkIn, stay.checkOut, daysBetween(stay.checkIn, stay.checkOut));
  }
}
