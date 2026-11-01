import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert, LucideCircleCheck } from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import { fieldMessage, type Problem, toProblem } from '../../core/api/problem';
import { passwordAcceptable } from '../../core/auth/password-rules';
import { SessionService } from '../../core/auth/session.service';
import { AuthCard } from '../../shared/ui/auth-card';
import { PasswordRulesList } from '../../shared/ui/password-rules-list';

const TOKEN_KEY = 'gestion.jeton-mot-de-passe';

/**
 * Reads the link token from « #jeton=… », then removes it from the address bar: it stays out of
 * the history, of bookmarks and of screenshots. It is kept for this tab only (sessionStorage), so
 * that reloading the page does not lose a link that is still valid.
 */
function takeLinkToken(): string | null {
  const match = /(?:^#|&)jeton=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (match?.[1] !== undefined) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      sessionStorage.setItem(TOKEN_KEY, match[1]);
    } catch {
      // Private browsing: the token simply lives in memory.
    }
    return match[1];
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function forgetLinkToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}

/**
 * New password from an e-mailed link (forgotten password, or first password of a new account).
 * The rules are shown live. A link without its token (copied without the « #jeton=… » part) and
 * a link refused by the server get distinct messages; both offer to receive a new one.
 */
@Component({
  selector: 'adm-reset-password-page',
  imports: [AuthCard, RouterLink, PasswordRulesList, LucideCircleAlert, LucideCircleCheck],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <adm-auth-card heading="Choisir un mot de passe">
      @if (done()) {
        <div class="alert-success" role="status">
          <svg lucideCircleCheck class="mt-0.5 shrink-0 text-success"></svg>
          <p>Votre mot de passe est enregistré. Vous pouvez maintenant vous connecter.</p>
        </div>
        <a routerLink="/connexion" class="mt-5 btn-primary w-full">Se connecter</a>
      } @else if (token === null) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <p>
            Ce lien est incomplet. Copiez-le en entier depuis l’e-mail, ou ouvrez-le dans le
            navigateur où vous l’aviez déjà ouvert.
          </p>
        </div>
        <a routerLink="/mot-de-passe-oublie" class="mt-5 btn-secondary w-full">
          Recevoir un nouveau lien
        </a>
      } @else if (linkInvalid()) {
        <div class="alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <p>Ce lien a expiré ou a déjà servi.</p>
        </div>
        <a routerLink="/mot-de-passe-oublie" class="mt-5 btn-primary w-full">
          Recevoir un nouveau lien
        </a>
      } @else {
        @if (problem(); as error) {
          <div class="mb-5 alert-error" role="alert">
            <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
            <p>
              <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
            </p>
          </div>
        }
        <form class="flex flex-col gap-5" novalidate (submit)="$event.preventDefault(); save()">
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="nouveau">Nouveau mot de passe</label>
            <input
              id="nouveau"
              class="field-control"
              type="password"
              autocomplete="new-password"
              aria-describedby="regles-mot-de-passe"
              [attr.aria-invalid]="newPasswordError() ? true : null"
              [value]="password()"
              (input)="password.set(valueOf($event))"
            />
            @if (newPasswordError(); as message) {
              <p class="field-error">{{ message }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="field-label" for="confirmation">Confirmer le mot de passe</label>
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
          <button type="submit" class="btn-primary w-full" [disabled]="!acceptable() || pending()">
            {{ pending() ? 'Enregistrement…' : 'Enregistrer le mot de passe' }}
          </button>
        </form>
      }
    </adm-auth-card>
  `,
})
export class ResetPasswordPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ADMIN_API);
  private readonly session = inject(SessionService);

  protected readonly token = takeLinkToken();
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly pending = signal(false);
  protected readonly done = signal(false);
  protected readonly linkInvalid = signal(false);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly acceptable = computed(() =>
    passwordAcceptable(this.password(), this.confirmation()),
  );
  protected readonly newPasswordError = computed(() => fieldMessage(this.problem(), 'newPassword'));

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async save(): Promise<void> {
    if (this.token === null || !this.acceptable()) {
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    try {
      await firstValueFrom(
        this.http.post(`${this.api}/password-reset/confirm`, {
          token: this.token,
          newPassword: this.password(),
        }),
      );
      // Every session of the account was closed by the server.
      forgetLinkToken();
      this.session.clear();
      this.done.set(true);
    } catch (error) {
      const problem = toProblem(error);
      if (problem.code === 'INVALID_RESET_TOKEN') {
        forgetLinkToken();
        this.linkInvalid.set(true);
      } else {
        this.problem.set(problem);
      }
    } finally {
      this.pending.set(false);
    }
  }
}
