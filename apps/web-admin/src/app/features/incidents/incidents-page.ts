import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideCircleAlert, LucidePlus, LucideRefreshCw } from '@lucide/angular';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { NotifierService } from '../../core/notifier.service';
import { IncidentApi, type IncidentFilter } from './incident-api';
import {
  assigneeText,
  formatDateTime,
  type Incident,
  type IncidentPriority,
  type IncidentStatus,
  placeOf,
  PRIORITY_LABELS,
  type RoomChoice,
  STATUS_LABELS,
} from './incident-model';

/** '' : every incident not closed; 'all' : closed ones included; or one state. */
type StatusFilter = '' | 'all' | IncidentStatus;

interface Draft {
  roomId: string;
  location: string;
  title: string;
  description: string;
  priority: IncidentPriority;
  blocksRoom: boolean;
}

const EMPTY_DRAFT: Draft = {
  roomId: '',
  location: '',
  title: '',
  description: '',
  priority: 'normal',
  blocksRoom: false,
};

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Non clôturées' },
  { value: 'reported', label: 'Signalées' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'resolved', label: 'Résolues' },
  { value: 'closed', label: 'Clôturées' },
  { value: 'all', label: 'Toutes' },
];

const PRIORITIES: readonly IncidentPriority[] = ['urgent', 'normal', 'low'];

/**
 * Incidents (UI/UX specification, section 5.H): the list, urgent ones first and marked in red,
 * with filters, and « Signaler une panne » for every staff member. A tap on an incident opens
 * its page (history, actions). `?chambre=<id>` (link of the housekeeping board) opens the form
 * with that room already chosen.
 */
@Component({
  selector: 'adm-incidents-page',
  imports: [RouterLink, LucidePlus, LucideRefreshCw, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <p class="mr-auto text-lg font-semibold" role="status">{{ countText() }}</p>
        <button type="button" class="btn-quiet" [disabled]="loading()" (click)="load()">
          <svg lucideRefreshCw></svg>
          Actualiser
        </button>
        <button type="button" class="btn-primary" (click)="openReport()">
          <svg lucidePlus></svg>
          Signaler une panne
        </button>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="filtre-etat">État</label>
          <select id="filtre-etat" class="field-control w-44" (change)="statusOf($event)">
            @for (option of statusFilters; track option.value) {
              <option [value]="option.value" [selected]="statusFilter() === option.value">
                {{ option.label }}
              </option>
            }
          </select>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="filtre-priorite">Priorité</label>
          <select id="filtre-priorite" class="field-control w-40" (change)="priorityOf($event)">
            <option value="" [selected]="priorityFilter() === null">Toutes</option>
            @for (value of priorities; track value) {
              <option [value]="value" [selected]="priorityFilter() === value">
                {{ priorityLabel(value) }}
              </option>
            }
          </select>
        </div>
        <label class="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            class="size-5 accent-port"
            [checked]="mine()"
            (change)="toggleMine()"
          />
          Seulement les miennes
        </label>
      </div>

      @if (problem(); as error) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <div>
            <p>
              <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
            </p>
            <button type="button" class="-ml-3 btn-quiet" (click)="load()">Réessayer</button>
          </div>
        </div>
      } @else if (loading() && incidents().length === 0) {
        <p class="text-muted" role="status">Chargement des pannes…</p>
      } @else {
        <ul class="flex flex-col gap-3" aria-label="Pannes">
          @for (incident of incidents(); track incident.id) {
            <li>
              <a
                class="card flex flex-col gap-1 p-4 hover:border-port"
                [class.incident-urgent]="incident.priority === 'urgent'"
                [routerLink]="['/pannes', incident.id]"
              >
                <span class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="text-muted">{{ incident.reference }}</span>
                  <span [class]="priorityBadge(incident)">{{ priority(incident) }}</span>
                  <span class="badge-neutral">{{ statusLabel(incident.status) }}</span>
                  @if (incident.roomBlocked) {
                    <span class="badge-off">Chambre hors service</span>
                  }
                </span>
                <span class="font-semibold">{{ incident.title }}</span>
                <span class="text-sm text-muted">
                  {{ place(incident) }} · {{ assignee(incident) }} · {{ when(incident.reportedAt) }}
                </span>
              </a>
            </li>
          } @empty {
            <li class="card p-6 text-center text-muted">Aucune panne à afficher.</li>
          }
        </ul>
      }
    </div>

    <!-- Report an incident -->
    <dialog
      #reportDialog
      class="dialog-panel"
      aria-labelledby="titre-signalement"
      (close)="formProblem.set(null)"
    >
      <form class="flex flex-col gap-5 p-6" novalidate (submit)="$event.preventDefault(); report()">
        <h2 id="titre-signalement" class="text-lg font-semibold">Signaler une panne</h2>
        @if (formProblem(); as error) {
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
          <label class="field-label" for="panne-chambre">Chambre</label>
          <select
            id="panne-chambre"
            class="field-control"
            [attr.aria-invalid]="error('roomId') ? true : null"
            (change)="roomOf($event)"
          >
            <option value="" [selected]="draft().roomId === ''">Pas une chambre (lieu)</option>
            @for (room of rooms(); track room.id) {
              <option [value]="room.id" [selected]="draft().roomId === room.id">
                Chambre {{ room.number }}
              </option>
            }
          </select>
          @if (error('roomId'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        @if (draft().roomId === '') {
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="panne-lieu">Lieu</label>
            <input
              id="panne-lieu"
              class="field-control"
              autocomplete="off"
              placeholder="Ascenseur, hall, cuisine…"
              [attr.aria-invalid]="error('location') ? true : null"
              [value]="draft().location"
              (input)="patch({ location: valueOf($event) })"
            />
            @if (error('location'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        }
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="panne-titre">Titre</label>
          <input
            id="panne-titre"
            class="field-control"
            autocomplete="off"
            placeholder="Fuite sous le lavabo"
            [attr.aria-invalid]="error('title') ? true : null"
            [value]="draft().title"
            (input)="patch({ title: valueOf($event) })"
          />
          @if (error('title'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="panne-description">Description</label>
          <textarea
            id="panne-description"
            class="field-control h-28 py-2"
            [attr.aria-invalid]="error('description') ? true : null"
            [value]="draft().description"
            (input)="patch({ description: valueOf($event) })"
          ></textarea>
          @if (error('description'); as message) {
            <p class="field-error">{{ message }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="panne-priorite">Priorité</label>
          <select id="panne-priorite" class="field-control" (change)="draftPriorityOf($event)">
            @for (value of priorities; track value) {
              <option [value]="value" [selected]="draft().priority === value">
                {{ priorityLabel(value) }}
              </option>
            }
          </select>
        </div>
        @if (draft().roomId !== '') {
          <label class="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              class="mt-0.5 size-5 accent-port"
              [checked]="draft().blocksRoom"
              (change)="patch({ blocksRoom: !draft().blocksRoom })"
            />
            <span>
              <span class="block font-semibold">Chambre inutilisable</span>
              <span class="block text-sm text-muted">
                Elle est retirée de la vente tout de suite, jusqu’à la résolution de la panne.
              </span>
            </span>
          </label>
        }
        <div class="flex flex-wrap justify-end gap-3">
          <button type="button" class="btn-quiet" (click)="reportDialog.close()">Retour</button>
          <button type="submit" class="btn-primary" [disabled]="saving()">Signaler</button>
        </div>
      </form>
    </dialog>
  `,
})
export class IncidentsPage {
  /** `?chambre=` : room to report, chosen in advance. */
  readonly chambre = input<string>();

  private readonly api = inject(IncidentApi);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);
  private readonly reportDialog = viewChild.required<ElementRef<HTMLDialogElement>>('reportDialog');

  protected readonly statusFilters = STATUS_FILTERS;
  protected readonly priorities = PRIORITIES;

  protected readonly incidents = signal<Incident[]>([]);
  protected readonly rooms = signal<RoomChoice[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly statusFilter = signal<StatusFilter>('');
  protected readonly priorityFilter = signal<IncidentPriority | null>(null);
  protected readonly mine = signal(false);

  protected readonly draft = signal<Draft>(EMPTY_DRAFT);
  protected readonly formProblem = signal<Problem | null>(null);
  protected readonly saving = signal(false);

  protected readonly countText = computed(() => {
    const count = this.incidents().length;
    return count === 1 ? '1 panne' : `${count} pannes`;
  });

  constructor() {
    void this.load();
    afterNextRender(() => {
      const roomId = this.chambre();
      if (roomId !== undefined && roomId !== '') {
        void this.openReport(roomId);
        // Read once: a reload of the page must not open the form again.
        void this.router.navigate(['/pannes'], { replaceUrl: true });
      }
    });
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    const status = this.statusFilter();
    const filter: IncidentFilter = { mine: this.mine(), includeClosed: status === 'all' };
    if (status !== '' && status !== 'all') {
      filter.status = status;
    }
    const priority = this.priorityFilter();
    if (priority !== null) {
      filter.priority = priority;
    }
    try {
      this.incidents.set(await this.api.list(filter));
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected statusLabel(status: IncidentStatus): string {
    return STATUS_LABELS[status];
  }

  protected priorityLabel(priority: IncidentPriority): string {
    return PRIORITY_LABELS[priority];
  }

  protected priority(incident: Incident): string {
    return PRIORITY_LABELS[incident.priority];
  }

  protected priorityBadge(incident: Incident): string {
    return incident.priority === 'urgent' ? 'badge-off' : 'badge-neutral';
  }

  protected place(incident: Incident): string {
    return placeOf(incident);
  }

  protected assignee(incident: Incident): string {
    return assigneeText(incident);
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected statusOf(event: Event): void {
    const value = this.valueOf(event);
    const option = STATUS_FILTERS.find((item) => item.value === value);
    this.statusFilter.set(option?.value ?? '');
    void this.load();
  }

  protected priorityOf(event: Event): void {
    const value = this.valueOf(event);
    this.priorityFilter.set(PRIORITIES.find((item) => item === value) ?? null);
    void this.load();
  }

  protected toggleMine(): void {
    this.mine.update((value) => !value);
    void this.load();
  }

  // --- Report form ---

  protected error(field: string): string | undefined {
    return fieldMessage(this.formProblem(), field);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected roomOf(event: Event): void {
    const roomId = this.valueOf(event);
    // A place cannot be « unusable »: the box is cleared when no room is chosen.
    this.patch(roomId === '' ? { roomId, blocksRoom: false } : { roomId });
  }

  protected draftPriorityOf(event: Event): void {
    const value = this.valueOf(event);
    this.patch({ priority: PRIORITIES.find((item) => item === value) ?? 'normal' });
  }

  /** `roomId`: the room to choose in advance, if it is among the active rooms. */
  protected async openReport(roomId?: string): Promise<void> {
    this.draft.set(EMPTY_DRAFT);
    this.formProblem.set(null);
    this.reportDialog().nativeElement.showModal();
    if (this.rooms().length === 0) {
      try {
        this.rooms.set(await this.api.rooms());
      } catch (error) {
        this.formProblem.set(toProblem(error));
      }
    }
    if (roomId !== undefined && this.rooms().some((room) => room.id === roomId)) {
      this.patch({ roomId });
    }
  }

  protected async report(): Promise<void> {
    const draft = this.draft();
    this.saving.set(true);
    this.formProblem.set(null);
    try {
      const incident = await this.api.report({
        roomId: draft.roomId === '' ? null : draft.roomId,
        location: draft.roomId === '' ? draft.location.trim() : null,
        title: draft.title.trim(),
        description: draft.description.trim(),
        priority: draft.priority,
        blocksRoom: draft.roomId !== '' && draft.blocksRoom,
      });
      this.reportDialog().nativeElement.close();
      this.notifier.success(`Panne ${incident.reference} signalée.`);
      await this.router.navigate(['/pannes', incident.id]);
    } catch (error) {
      this.formProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }
}
