import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ZelligeStar } from './zellige-star';

/** From this width (tablet), the photo of the login page is loaded and shown. */
const WIDE_SCREEN = '(min-width: 48rem)';

/**
 * Frame of the pages without session (UI/UX specification, section 5.A): slate background with a
 * zellige pattern, card with the logo and the title. With `photoUrl` (login page), on large
 * screens only, a photo covers the whole page behind a slate veil: it fades in once loaded and
 * zooms very slowly (not when the system asks for less motion); the card, frosted, stays on the
 * left. On phones the photo is never downloaded; if it does not load, the pattern stays.
 */
@Component({
  selector: 'adm-auth-card',
  imports: [ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div [class]="pageClass()">
      @if (showPhoto()) {
        <div class="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          @if (!photoFailed()) {
            <img
              class="auth-photo size-full object-cover"
              [class.is-loaded]="photoLoaded()"
              [src]="photoUrl()"
              alt=""
              decoding="async"
              referrerpolicy="no-referrer"
              (load)="photoLoaded.set(true)"
              (error)="photoFailed.set(true)"
            />
          }
          <div
            class="absolute inset-0 bg-linear-to-r from-slate-nav/90 via-slate-nav/45 to-transparent"
          ></div>
        </div>
      }
      <main class="w-full max-w-md">
        <div class="card bg-surface/90 p-6 shadow-dialog backdrop-blur-md sm:p-8">
          <div class="mb-6 flex items-center gap-2">
            <adm-zellige-star class="size-6 text-clay" />
            <span class="font-semibold tracking-wide text-port uppercase">Riad Vieux-Port</span>
          </div>
          <h1 class="text-xl font-semibold" [class.mb-6]="!subtitle()">{{ heading() }}</h1>
          @if (subtitle(); as text) {
            <p class="mt-1 mb-6 text-muted">{{ text }}</p>
          }
          <ng-content />
        </div>
        <ng-content select="[afterCard]" />
      </main>
    </div>
  `,
})
export class AuthCard {
  readonly heading = input.required<string>();
  /** Line under the title. */
  readonly subtitle = input<string | null>(null);
  /** Photo behind the card, large screens only. */
  readonly photoUrl = input<string | null>(null);

  protected readonly photoLoaded = signal(false);
  protected readonly photoFailed = signal(false);
  private readonly wideScreen = signal(false);

  protected readonly showPhoto = computed(() => this.photoUrl() !== null && this.wideScreen());
  protected readonly pageClass = computed(() =>
    [
      'auth-pattern relative isolate flex min-h-dvh items-center justify-center overflow-hidden',
      'bg-slate-nav px-4 py-10',
      this.photoUrl() === null ? '' : 'md:justify-start md:px-16 lg:px-28',
    ].join(' '),
  );

  constructor() {
    const query = window.matchMedia(WIDE_SCREEN);
    const update = (): void => this.wideScreen.set(query.matches);
    update();
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}
