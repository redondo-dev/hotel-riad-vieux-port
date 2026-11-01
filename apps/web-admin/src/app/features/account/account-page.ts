import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucideCircleAlert } from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { passwordAcceptable } from '../../core/auth/password-rules';
import { ROLE_LABELS } from '../../core/auth/roles';
import { SessionService } from '../../core/auth/session.service';
import { NotifierService } from '../../core/notifier.service';
import { PasswordRulesList } from '../../shared/ui/password-rules-list';

/** « Mon compte » (all roles): who I am, and changing my own password. */
@Component({
  selector: 'adm-account-page',
  imports: [PasswordRulesList, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-w-3xl flex-col gap-6">
      @if (session.user(); as user) {
        <section class="card p-6" aria-labelledby="identite">
          <h2 id="identite" class="text-lg font-semibold">Mes informations</h2>
          <dl class="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
            <dt class="text-sm font-semibold text-muted">Nom</dt>
            <dd>{{ user.firstName }} {{ user.lastName }}</dd>
            <dt class="text-sm font-semibold text-muted">Adresse e-mail</dt>
            <dd>{{ user.email }}</dd>
            <dt class="text-sm font-semibold text-muted">Rôle</dt>
            <dd>{{ roleLabel() }}</dd>
          </dl>
          <p class="mt-4 text-sm text-muted">
            Pour modifier ces informations, adressez-vous à la direction.
          </p>
        </section>
      }

      <section class="card p-6" aria-labelledby="mot-de-passe">
        <h2 id="mot-de-passe" class="text-lg font-semibold">Changer mon mot de passe</h2>
        <p class="mt-1 text-sm text-muted">
          Vos autres sessions ouvertes (autre ordinateur, tablette) seront fermées.
        </p>
        @if (problem(); as error) {
          @if (error.errors.length === 0) {
            <div class="mt-4 alert-error" role="alert">
              <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
              <p>
                <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
              </p>
            </div>
          }
        }
        <form
          class="mt-5 flex max-w-md flex-col gap-5"
          novalidate
          (submit)="$event.preventDefault(); save()"
        >
          <input type="text" class="hidden" autocomplete="username" [value]="email()" readonly />
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="actuel">Mot de passe actuel</label>
            <input
              id="actuel"
              class="field-control"
              type="password"
              autocomplete="current-password"
              [attr.aria-invalid]="currentError() ? true : null"
              [attr.aria-describedby]="currentError() ? 'actuel-erreur' : null"
              [value]="current()"
              (input)="current.set(valueOf($event))"
            />
            @if (currentError(); as message) {
              <p id="actuel-erreur" class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="nouveau">Nouveau mot de passe</label>
            <input
              id="nouveau"
              class="field-control"
              type="password"
              autocomplete="new-password"
              aria-describedby="regles-mot-de-passe"
              [attr.aria-invalid]="newError() ? true : null"
              [value]="password()"
              (input)="password.set(valueOf($event))"
            />
            @if (newError(); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="confirmation">Confirmer le nouveau mot de passe</label>
            <input
              id="confirmation"
              class="field-control"
              type="password"
              autocomplete="new-password"
              aria-describedby="regles-mot-de-passe"
              [value]="confirmation()"
              (input)="confirmation.set(valueOf($event))"
            />
          </div>
          <adm-password-rules-list [password]="password()" [confirmation]="confirmation()" />
          <div>
            <button
              type="submit"
              class="btn-primary"
              [disabled]="current() === '' || !acceptable() || pending()"
            >
              {{ pending() ? 'Enregistrement…' : 'Changer le mot de passe' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
})
export class AccountPage {
  protected readonly session = inject(SessionService);
  private readonly http = inject(HttpClient);
  private readonly api = inject(ADMIN_API);
  private readonly notifier = inject(NotifierService);

  protected readonly current = signal('');
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly pending = signal(false);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly roleLabel = computed(() => {
    const user = this.session.user();
    return user === null ? '' : ROLE_LABELS[user.role];
  });
  protected readonly acceptable = computed(() =>
    passwordAcceptable(this.password(), this.confirmation()),
  );
  protected readonly currentError = computed(() => fieldMessage(this.problem(), 'currentPassword'));
  protected readonly newError = computed(() => fieldMessage(this.problem(), 'newPassword'));

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async save(): Promise<void> {
    if (this.current() === '' || !this.acceptable() || this.pending()) {
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    try {
      await firstValueFrom(
        this.http.post(`${this.api}/session/password`, {
          currentPassword: this.current(),
          newPassword: this.password(),
        }),
      );
      this.current.set('');
      this.password.set('');
      this.confirmation.set('');
      this.notifier.success('Votre mot de passe a été changé.');
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.pending.set(false);
    }
  }
}
