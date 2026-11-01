import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert, LucideMail } from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import { type Problem, toProblem } from '../../core/api/problem';
import { AuthCard } from '../../shared/ui/auth-card';

/**
 * Forgotten password (UI/UX specification, section 5.A): same message whether the address has
 * an account or not.
 */
@Component({
  selector: 'adm-forgot-password-page',
  imports: [AuthCard, RouterLink, LucideMail, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <adm-auth-card heading="Mot de passe oublié">
      @if (sent()) {
        <div class="alert-success" role="status">
          <svg lucideMail class="mt-0.5 shrink-0 text-success"></svg>
          <p>
            Si un compte existe pour cette adresse, un e-mail vient d’être envoyé. Le lien qu’il
            contient est valable 30 minutes.
          </p>
        </div>
      } @else {
        <p class="mb-5 text-muted">
          Indiquez l’adresse e-mail de votre compte : vous recevrez un lien pour choisir un nouveau
          mot de passe.
        </p>
        @if (problem(); as error) {
          <div class="mb-5 alert-error" role="alert">
            <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
            <p>
              <span class="font-semibold">{{ error.title }}.</span> {{ error.detail }}
            </p>
          </div>
        }
        <form class="flex flex-col gap-5" novalidate (submit)="$event.preventDefault(); send()">
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
          <button type="submit" class="btn-primary w-full" [disabled]="pending()">
            {{ pending() ? 'Envoi…' : 'Recevoir un lien' }}
          </button>
        </form>
      }
      <p class="mt-5 text-center">
        <a routerLink="/connexion" class="btn-quiet">Retour à la connexion</a>
      </p>
    </adm-auth-card>
  `,
})
export class ForgotPasswordPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ADMIN_API);

  protected readonly email = signal('');
  protected readonly pending = signal(false);
  protected readonly sent = signal(false);
  protected readonly problem = signal<Problem | null>(null);

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async send(): Promise<void> {
    const email = this.email().trim();
    if (email === '') {
      this.problem.set({
        status: 400,
        code: 'MISSING_FIELDS',
        title: 'Adresse manquante',
        detail: 'Indiquez votre adresse e-mail.',
        errors: [],
      });
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    try {
      await firstValueFrom(this.http.post(`${this.api}/password-reset`, { email }));
      this.sent.set(true);
    } catch (error) {
      this.problem.set(toProblem(error));
    } finally {
      this.pending.set(false);
    }
  }
}
