import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideCircleAlert,
  LucideKeyRound,
  LucidePencil,
  LucideUserCheck,
  LucideUserPlus,
  LucideUserX,
} from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { ROLE_LABELS, ROLES, type Role, type StaffUser } from '../../core/auth/roles';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import {
  canChangeRole,
  canDeactivate,
  formatLastLogin,
  type Permission,
  type UserSummary,
} from './user-rules';

interface Draft {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

const EMPTY_DRAFT: Draft = { email: '', firstName: '', lastName: '', role: 'reception' };

/**
 * Staff accounts, management only (UI/UX specification, section 5.L): list, invite (the person
 * receives a link to choose their password), rename or change role, deactivate or reactivate
 * after confirmation, send a reset link. Actions refused by the safeguards are disabled with
 * their explanation; the API refuses them anyway.
 */
@Component({
  selector: 'adm-users-page',
  imports: [
    LucideUserPlus,
    LucidePencil,
    LucideUserX,
    LucideUserCheck,
    LucideKeyRound,
    LucideCircleAlert,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-muted">
          {{ users().length }} compte{{ users().length > 1 ? 's' : '' }}, dont
          {{ activeCount() }} actif{{ activeCount() > 1 ? 's' : '' }}.
        </p>
        <button type="button" class="btn-primary" (click)="openInvite()">
          <svg lucideUserPlus></svg>
          Inviter un utilisateur
        </button>
      </div>

      @if (loadProblem(); as error) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <div>
            <p>
              <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
            </p>
            <button type="button" class="-ml-3 btn-quiet" (click)="load()">Réessayer</button>
          </div>
        </div>
      } @else if (loading() && users().length === 0) {
        <p class="text-muted" role="status">Chargement des comptes…</p>
      } @else {
        <ul class="flex flex-col gap-3" aria-label="Comptes du personnel">
          @for (user of users(); track user.id) {
            <li class="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-6">
              <div class="min-w-0 flex-1">
                <p class="font-semibold">
                  {{ user.firstName }} {{ user.lastName }}
                  @if (user.id === me()?.id) {
                    <span class="text-sm font-normal text-muted">(vous)</span>
                  }
                </p>
                <p class="truncate text-sm text-muted">{{ user.email }}</p>
              </div>
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm lg:w-80">
                <dt class="text-muted">Rôle</dt>
                <dd class="font-medium">{{ roleLabel(user.role) }}</dd>
                <dt class="text-muted">Statut</dt>
                <dd>
                  @if (user.isActive) {
                    <span class="rounded-full bg-success-pale px-2 py-0.5 font-medium text-success"
                      >Actif</span
                    >
                  } @else {
                    <span class="rounded-full bg-danger-pale px-2 py-0.5 font-medium text-danger"
                      >Désactivé</span
                    >
                  }
                </dd>
                <dt class="text-muted">Dernière connexion</dt>
                <dd>{{ lastLogin(user.lastLoginAt) }}</dd>
              </dl>
              <div class="flex flex-wrap gap-2 lg:w-auto lg:justify-end">
                <button type="button" class="btn-secondary" (click)="openEdit(user)">
                  <svg lucidePencil></svg>
                  Modifier
                  <span class="sr-only">le compte de {{ user.firstName }} {{ user.lastName }}</span>
                </button>
                @if (user.isActive) {
                  @let deactivation = deactivationOf(user);
                  <button
                    type="button"
                    class="btn-secondary"
                    [disabled]="!deactivation.allowed"
                    [attr.aria-describedby]="deactivation.allowed ? null : 'raison-' + user.id"
                    (click)="askToggle(user)"
                  >
                    <svg lucideUserX></svg>
                    Désactiver
                    <span class="sr-only">{{ user.firstName }} {{ user.lastName }}</span>
                  </button>
                  <button type="button" class="btn-quiet" (click)="sendLink(user)">
                    <svg lucideKeyRound></svg>
                    Envoyer un lien
                    <span class="sr-only">de mot de passe à {{ user.firstName }}</span>
                  </button>
                  @if (!deactivation.allowed) {
                    <p [id]="'raison-' + user.id" class="w-full text-sm text-muted lg:text-right">
                      {{ deactivation.reason }}
                    </p>
                  }
                } @else {
                  <button type="button" class="btn-secondary" (click)="askToggle(user)">
                    <svg lucideUserCheck></svg>
                    Réactiver
                    <span class="sr-only">{{ user.firstName }} {{ user.lastName }}</span>
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>

    <!-- Invite or edit -->
    <dialog
      #formDialog
      class="dialog-panel"
      aria-labelledby="titre-formulaire"
      (close)="formProblem.set(null)"
    >
      <form
        class="flex flex-col gap-5 p-6"
        novalidate
        (submit)="$event.preventDefault(); saveForm()"
      >
        <h2 id="titre-formulaire" class="text-lg font-semibold">
          {{ editing() === null ? 'Inviter un utilisateur' : 'Modifier le compte' }}
        </h2>
        @if (editing() === null) {
          <p class="-mt-3 text-sm text-muted">
            La personne recevra un e-mail pour choisir elle-même son mot de passe (lien valable 48
            heures).
          </p>
        }
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
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="prenom">Prénom</label>
            <input
              id="prenom"
              class="field-control"
              autocomplete="off"
              [attr.aria-invalid]="formError('firstName') ? true : null"
              [value]="draft().firstName"
              (input)="patch({ firstName: valueOf($event) })"
            />
            @if (formError('firstName'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="nom">Nom</label>
            <input
              id="nom"
              class="field-control"
              autocomplete="off"
              [attr.aria-invalid]="formError('lastName') ? true : null"
              [value]="draft().lastName"
              (input)="patch({ lastName: valueOf($event) })"
            />
            @if (formError('lastName'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        </div>
        @if (editing() === null) {
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="email">Adresse e-mail</label>
            <input
              id="email"
              class="field-control"
              type="email"
              autocomplete="off"
              spellcheck="false"
              [attr.aria-invalid]="formError('email') ? true : null"
              [value]="draft().email"
              (input)="patch({ email: valueOf($event) })"
            />
            @if (formError('email'); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
        }
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="role">Rôle</label>
          <select
            id="role"
            class="field-control"
            [attr.aria-describedby]="roleChange().allowed ? null : 'role-raison'"
            (change)="patch({ role: roleOf($event) })"
          >
            @for (role of roles; track role) {
              <option [value]="role" [selected]="role === draft().role">
                {{ roleLabel(role) }}
              </option>
            }
          </select>
          @if (!roleChange().allowed) {
            <p id="role-raison" class="field-error">{{ roleChange().reason }}</p>
          }
        </div>
        <div class="flex flex-wrap justify-end gap-3">
          <button type="button" class="btn-quiet" (click)="formDialog.close()">Retour</button>
          <button type="submit" class="btn-primary" [disabled]="saving() || !roleChange().allowed">
            {{ editing() === null ? 'Envoyer l’invitation' : 'Enregistrer' }}
          </button>
        </div>
      </form>
    </dialog>

    <!-- Confirmation: deactivate or reactivate -->
    <dialog #confirmDialog class="dialog-panel" aria-labelledby="titre-confirmation">
      @if (toggling(); as user) {
        <div class="flex flex-col gap-4 p-6">
          <h2 id="titre-confirmation" class="text-lg font-semibold">
            {{ user.isActive ? 'Désactiver' : 'Réactiver' }} le compte de {{ user.firstName }}
            {{ user.lastName }} ?
          </h2>
          @if (user.isActive) {
            <p>
              La personne ne pourra plus se connecter, et ses sessions ouvertes seront fermées
              immédiatement. Le compte et son historique sont conservés : vous pourrez le réactiver.
            </p>
          } @else {
            <p>La personne pourra de nouveau se connecter avec son mot de passe.</p>
          }
          <div class="flex flex-wrap justify-end gap-3">
            <button type="button" class="btn-quiet" (click)="confirmDialog.close()">Retour</button>
            <button
              type="button"
              [class]="user.isActive ? 'btn-danger' : 'btn-primary'"
              [disabled]="saving()"
              (click)="confirmToggle(user)"
            >
              {{ user.isActive ? 'Désactiver le compte' : 'Réactiver le compte' }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class UsersPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ADMIN_API);
  private readonly session = inject(SessionService);
  private readonly notifier = inject(NotifierService);

  private readonly formDialog = viewChild.required<ElementRef<HTMLDialogElement>>('formDialog');
  private readonly confirmDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected readonly roles = ROLES;
  protected readonly me = this.session.user;
  protected readonly users = signal<UserSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadProblem = signal<Problem | null>(null);

  protected readonly editing = signal<UserSummary | null>(null);
  protected readonly draft = signal<Draft>(EMPTY_DRAFT);
  protected readonly formProblem = signal<Problem | null>(null);
  protected readonly toggling = signal<UserSummary | null>(null);
  protected readonly saving = signal(false);

  protected readonly activeCount = computed(
    () => this.users().filter((user) => user.isActive).length,
  );

  /** In the edit form: can the chosen role be applied? */
  protected readonly roleChange = computed<Permission>(() => {
    const target = this.editing();
    const actor = this.me();
    if (target === null || actor === null) {
      return { allowed: true };
    }
    return canChangeRole(target, actor, this.users(), this.draft().role);
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadProblem.set(null);
    try {
      const result = await firstValueFrom(
        this.http.get<{ users: UserSummary[] }>(`${this.api}/users`),
      );
      this.users.set(result.users);
    } catch (error) {
      this.loadProblem.set(toProblem(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected roleLabel(role: Role): string {
    return ROLE_LABELS[role];
  }

  protected lastLogin(value: string | null): string {
    return formatLastLogin(value);
  }

  protected deactivationOf(user: UserSummary): Permission {
    const actor = this.me();
    return actor === null ? { allowed: false } : canDeactivate(user, actor, this.users());
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected roleOf(event: Event): Role {
    const value = (event.target as HTMLSelectElement).value;
    return (ROLES as readonly string[]).includes(value) ? (value as Role) : this.draft().role;
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected formError(field: string): string | undefined {
    return fieldMessage(this.formProblem(), field);
  }

  protected openInvite(): void {
    this.editing.set(null);
    this.draft.set(EMPTY_DRAFT);
    this.formProblem.set(null);
    this.formDialog().nativeElement.showModal();
  }

  protected openEdit(user: UserSummary): void {
    this.editing.set(user);
    this.draft.set({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    });
    this.formProblem.set(null);
    this.formDialog().nativeElement.showModal();
  }

  protected async saveForm(): Promise<void> {
    const target = this.editing();
    const draft = this.draft();
    this.saving.set(true);
    this.formProblem.set(null);
    try {
      if (target === null) {
        const result = await firstValueFrom(
          this.http.post<{ user: StaffUser; invitationSent: boolean }>(`${this.api}/users`, {
            email: draft.email.trim(),
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim(),
            role: draft.role,
          }),
        );
        if (result.invitationSent) {
          this.notifier.success(`Invitation envoyée à ${result.user.email}.`);
        } else {
          this.notifier.error(
            `Le compte de ${result.user.email} est créé, mais l’e-mail n’a pas pu partir. ` +
              'Utilisez « Envoyer un lien » pour réessayer.',
          );
        }
      } else {
        await firstValueFrom(
          this.http.patch(`${this.api}/users/${target.id}`, {
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim(),
            role: draft.role,
          }),
        );
        this.notifier.success(`Le compte de ${draft.firstName.trim()} est modifié.`);
      }
      this.formDialog().nativeElement.close();
      await this.load();
    } catch (error) {
      this.formProblem.set(toProblem(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected askToggle(user: UserSummary): void {
    this.toggling.set(user);
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmToggle(user: UserSummary): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`${this.api}/users/${user.id}`, { isActive: !user.isActive }),
      );
      this.notifier.success(
        user.isActive
          ? `Le compte de ${user.firstName} est désactivé.`
          : `Le compte de ${user.firstName} est réactivé.`,
      );
      await this.load();
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    } finally {
      this.saving.set(false);
      this.confirmDialog().nativeElement.close();
    }
  }

  protected async sendLink(user: UserSummary): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.api}/users/${user.id}/password-reset`, {}));
      this.notifier.success(`Un lien de mot de passe a été envoyé à ${user.email}.`);
    } catch (error) {
      this.notifier.error(toProblem(error).detail);
    }
  }
}
