import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert, LucideRefreshCw, LucideSparkles, LucideWrench } from '@lucide/angular';
import { type Problem, toProblem } from '../../core/api/problem';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { HousekeepingApi } from './housekeeping-api';
import {
  canSetStatus,
  type FloorGroup,
  floorLabel,
  floorsOf,
  type HousekeepingRoom,
  nextStatus,
  remainingText,
  STATUS_LABELS,
} from './housekeeping-model';

/**
 * Housekeeping board (UI/UX specification, section 5.G), made first for the phone: one tile per
 * room, grouped by floor, green when clean and orange when to be cleaned. A tap changes the
 * state; « Tout l'étage est propre » cleans a whole floor after confirmation. The reception
 * can only mark a room to be cleaned. « Actualiser » reads the board again. The wrench of a
 * tile opens « Signaler une panne » with that room already chosen.
 */
@Component({
  selector: 'adm-housekeeping-page',
  imports: [RouterLink, LucideCircleAlert, LucideRefreshCw, LucideSparkles, LucideWrench],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
    } @else if (loading() && rooms().length === 0) {
      <p class="text-muted" role="status">Chargement des chambres…</p>
    } @else {
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <p class="mr-auto text-lg font-semibold" role="status">{{ remaining() }}</p>
          <button type="button" class="btn-quiet" [disabled]="loading()" (click)="load()">
            <svg lucideRefreshCw></svg>
            Actualiser
          </button>
        </div>
        @if (!canClean()) {
          <p class="-mt-2 text-sm text-muted">
            Vous pouvez signaler une chambre à nettoyer. Seul le ménage la déclare propre.
          </p>
        }

        <div class="flex flex-wrap items-end gap-3">
          <div
            class="flex rounded-lg border border-field bg-white p-1"
            role="group"
            aria-label="Chambres affichées"
          >
            <button
              type="button"
              class="h-9 rounded-md px-4 font-medium"
              [class.bg-port]="toDoOnly()"
              [class.text-white]="toDoOnly()"
              [attr.aria-pressed]="toDoOnly()"
              (click)="toDoOnly.set(true)"
            >
              À faire
            </button>
            <button
              type="button"
              class="h-9 rounded-md px-4 font-medium"
              [class.bg-port]="!toDoOnly()"
              [class.text-white]="!toDoOnly()"
              [attr.aria-pressed]="!toDoOnly()"
              (click)="toDoOnly.set(false)"
            >
              Toutes
            </button>
          </div>
          <label class="sr-only" for="filtre-etage">Étage</label>
          <select id="filtre-etage" class="field-control w-44" (change)="floorOf($event)">
            <option value="" [selected]="floor() === null">Tous les étages</option>
            @for (value of floorNumbers(); track value) {
              <option [value]="value" [selected]="floor() === value">{{ label(value) }}</option>
            }
          </select>
        </div>

        @for (group of floors(); track group.floor) {
          <section class="card flex flex-col gap-3 p-4" [attr.aria-label]="label(group.floor)">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold">
                {{ label(group.floor) }}
                <span class="font-normal text-muted">· {{ group.dirty }} à nettoyer</span>
              </h2>
              @if (canClean() && group.dirty > 0) {
                <button type="button" class="btn-quiet" (click)="askFloor(group)">
                  <svg lucideSparkles></svg>
                  Tout l’étage est propre
                </button>
              }
            </div>
            <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-9">
              @for (room of group.rooms; track room.id) {
                <li class="relative">
                  <button
                    type="button"
                    class="flex min-h-20 w-full flex-col items-center justify-center rounded-lg border-2 p-2 disabled:cursor-default"
                    [class]="room.status === 'clean' ? 'tile-clean' : 'tile-dirty'"
                    [class.tile-locked]="next(room) === null"
                    [disabled]="busy() || next(room) === null"
                    [attr.aria-label]="tileLabel(room)"
                    (click)="toggle(room)"
                  >
                    <span class="text-lg font-semibold">{{ room.number }}</span>
                    <span class="text-sm">{{ statusLabel(room) }}</span>
                  </button>
                  <a
                    class="absolute top-0 right-0 flex size-9 items-center justify-center rounded-lg text-muted hover:text-ink"
                    routerLink="/pannes"
                    [queryParams]="{ chambre: room.id }"
                    [attr.aria-label]="reportLabel(room)"
                    [attr.title]="reportLabel(room)"
                  >
                    <svg lucideWrench class="size-4"></svg>
                  </a>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="card p-6 text-center text-muted">
            {{ toDoOnly() ? 'Aucune chambre à nettoyer.' : 'Aucune chambre à afficher.' }}
          </p>
        }
      </div>
    }

    <!-- Confirmation: a whole floor clean -->
    <dialog #confirmDialog class="dialog-panel" aria-labelledby="titre-confirmation">
      @if (confirming(); as group) {
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-confirmation" class="text-lg font-semibold">
            {{ label(group.floor) }} : tout est propre ?
          </h2>
          <p>Les {{ group.dirty }} chambre(s) à nettoyer de cet étage passeront « Propre ».</p>
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="confirmDialog.close()">Retour</button>
            <button
              type="button"
              class="btn-primary"
              [disabled]="busy()"
              (click)="confirmFloor(group)"
            >
              Tout l’étage est propre
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class HousekeepingPage {
  private readonly api = inject(HousekeepingApi);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);
  private readonly confirmDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  private readonly role = computed(() => this.session.user()?.role);

  protected readonly rooms = signal<HousekeepingRoom[]>([]);
  protected readonly loading = signal(true);
  protected readonly problem = signal<Problem | null>(null);
  /** A change is being saved: the tiles wait, so that two taps never cross. */
  protected readonly busy = signal(false);
  protected readonly confirming = signal<FloorGroup | null>(null);

  protected readonly toDoOnly = signal(true);
  protected readonly floor = signal<number | null>(null);

  protected readonly canClean = computed(() => canSetStatus(this.role(), 'clean'));
  protected readonly remaining = computed(() => remainingText(this.rooms()));
  protected readonly floorNumbers = computed(() => {
    const floors = new Set(this.rooms().map((room) => room.floor));
    return [...floors].sort((a, b) => a - b);
  });
  protected readonly floors = computed(() => {
    return floorsOf(this.rooms(), { toDoOnly: this.toDoOnly(), floor: this.floor() });
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    try {
      this.rooms.set(await this.api.rooms());
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected label(floor: number): string {
    return floorLabel(floor);
  }

  protected next(room: HousekeepingRoom): 'clean' | 'dirty' | null {
    return nextStatus(room, this.role());
  }

  protected statusLabel(room: HousekeepingRoom): string {
    return STATUS_LABELS[room.status];
  }

  /** « Chambre 214, à nettoyer. Marquer propre. » for screen readers. */
  protected tileLabel(room: HousekeepingRoom): string {
    const next = this.next(room);
    const state = `Chambre ${room.number}, ${STATUS_LABELS[room.status].toLowerCase()}.`;
    return next === null ? state : `${state} Marquer ${STATUS_LABELS[next].toLowerCase()}.`;
  }

  protected reportLabel(room: HousekeepingRoom): string {
    return `Signaler une panne, chambre ${room.number}`;
  }

  protected floorOf(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.floor.set(value === '' ? null : Number(value));
  }

  private replace(updated: readonly HousekeepingRoom[]): void {
    const byId = new Map(updated.map((room) => [room.id, room]));
    this.rooms.update((rooms) => rooms.map((room) => byId.get(room.id) ?? room));
  }

  protected async toggle(room: HousekeepingRoom): Promise<void> {
    const next = this.next(room);
    if (next === null || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      this.replace([await this.api.setStatus(room.id, next)]);
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.busy.set(false);
    }
  }

  protected askFloor(group: FloorGroup): void {
    this.confirming.set(group);
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmFloor(group: FloorGroup): Promise<void> {
    const ids = this.rooms()
      .filter((room) => room.floor === group.floor && room.status === 'dirty')
      .map((room) => room.id);
    this.busy.set(true);
    try {
      const result = await this.api.setStatusOfRooms(ids, 'clean');
      this.replace(result.items);
      this.notifier.success(`${floorLabel(group.floor)} : ${result.changed} chambre(s) propre(s).`);
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.busy.set(false);
      this.confirmDialog().nativeElement.close();
    }
  }
}
