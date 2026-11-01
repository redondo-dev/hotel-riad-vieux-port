import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideCircleAlert, LucideEye, LucideEyeOff, LucideLogIn } from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import { type Problem, toProblem } from '../../core/api/problem';
import { safeReturnUrl } from '../../core/auth/return-url';
import { landingFor, ROLE_LABELS, type Role } from '../../core/auth/roles';
import { SessionService } from '../../core/auth/session.service';
import { AuthCard } from '../../shared/ui/auth-card';

interface DemoAccounts {
  password: string;
  accounts: { email: string; firstName: string; lastName: string; role: Role }[];
}

/**
 * Login (UI/UX specification, section 5.A). Wrong address, wrong password, deactivated or locked
 * account: the API gives one single message, shown as is, so that nobody can find out which
 * addresses have an account. Portfolio only: the demo accounts are listed under the card.
 */
@Component({
  selector: 'adm-login-page',
  imports: [AuthCard, RouterLink, LucideEye, LucideEyeOff, LucideLogIn, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <adm-auth-card heading="Connexion à l’outil de gestion">
      @if (problem(); as error) {
        <div class="mb-5 alert-error" role="alert">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <div class="flex-1">
            <p class="font-semibold">{{ error.title }}</p>
            <p>{{ error.detail }}</p>
            @if (error.status === 0) {
              <button type="button" class="mt-2 btn-quiet -ml-3" (click)="submit()">
                Réessayer
              </button>
            }
          </div>
        </div>
      }

      <form class="flex flex-col gap-5" novalidate (submit)="$event.preventDefault(); submit()">
        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="email">Adresse e-mail</label>
          <input
            id="email"
            class="field-control"
            type="email"
            autocomplete="username"
            spellcheck="false"
            required
            [value]="email()"
            (input)="email.set(valueOf($event))"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="field-label" for="password">Mot de passe</label>
          <div class="relative">
            <input
              id="password"
              class="field-control pr-12"
              [type]="showPassword() ? 'text' : 'password'"
              autocomplete="current-password"
              required
              [value]="password()"
              (input)="password.set(valueOf($event))"
            />
            <button
              type="button"
              class="absolute top-0 right-0 btn-icon text-muted"
              [attr.aria-pressed]="showPassword()"
              (click)="showPassword.update((value) => !value)"
            >
              @if (showPassword()) {
                <svg lucideEyeOff></svg>
              } @else {
                <svg lucideEye></svg>
              }
              <span class="sr-only">Afficher le mot de passe</span>
            </button>
          </div>
        </div>

        <button type="submit" class="btn-primary w-full" [disabled]="pending()">
          <svg lucideLogIn></svg>
          {{ pending() ? 'Connexion…' : 'Se connecter' }}
        </button>
      </form>

      <p class="mt-5 text-center">
        <a routerLink="/mot-de-passe-oublie" class="btn-quiet">Mot de passe oublié ?</a>
      </p>

      @if (demo(); as demoAccounts) {
        <section
          afterCard
          class="mt-6 rounded-xl bg-white/10 p-5 text-white"
          aria-labelledby="demo"
        >
          <h2 id="demo" class="font-semibold">Comptes de démonstration</h2>
          <p class="mt-1 text-sm text-white/80">
            Hôtel fictif (portfolio). Mot de passe commun :
            <code class="rounded bg-black/30 px-1.5 py-0.5">{{ demoAccounts.password }}</code>
          </p>
          <ul class="mt-3 flex flex-col gap-2">
            @for (account of demoAccounts.accounts; track account.email) {
              <li>
                <button
                  type="button"
                  class="flex w-full flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-white/10 px-3 py-2 text-left text-sm hover:bg-white/20"
                  (click)="useDemo(account.email, demoAccounts.password)"
                >
                  <span class="font-semibold">{{ roleLabel(account.role) }}</span>
                  <span class="text-white/80">{{ account.email }}</span>
                </button>
              </li>
            }
          </ul>
        </section>
      }
    </adm-auth-card>
  `,
})
export class LoginPage {
  /** `?retour=` : page to open after login. */
  readonly retour = input<string>();

  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly api = inject(ADMIN_API);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly pending = signal(false);
  protected readonly problem = signal<Problem | null>(null);
  protected readonly demo = signal<DemoAccounts | null>(null);

  constructor() {
    // 404 outside the demo mode: nothing is shown.
    firstValueFrom(this.http.get<DemoAccounts>(`${this.api}/demo`))
      .then((accounts) => {
        this.demo.set(accounts);
      })
      .catch(() => undefined);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected roleLabel(role: Role): string {
    return ROLE_LABELS[role];
  }

  protected useDemo(email: string, password: string): void {
    this.email.set(email);
    this.password.set(password);
    void this.submit();
  }

  protected async submit(): Promise<void> {
    if (this.pending()) {
      return;
    }
    if (this.email().trim() === '' || this.password() === '') {
      this.problem.set({
        status: 400,
        code: 'MISSING_FIELDS',
        title: 'Champs à compléter',
        detail: 'Indiquez votre adresse e-mail et votre mot de passe.',
        errors: [],
      });
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    try {
      const user = await this.session.logIn(this.email().trim(), this.password());
      await this.router.navigateByUrl(safeReturnUrl(this.retour()) ?? landingFor(user.role));
    } catch (error) {
      const problem = toProblem(error);
      this.problem.set(
        problem.status === 429
          ? { ...problem, title: 'Trop de tentatives', detail: 'Réessayez dans 15 minutes.' }
          : problem,
      );
      this.password.set('');
    } finally {
      this.pending.set(false);
    }
  }
}
