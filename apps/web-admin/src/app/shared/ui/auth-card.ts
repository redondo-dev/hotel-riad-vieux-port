import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ZelligeStar } from './zellige-star';

/**
 * Frame of the pages without session (UI/UX specification, section 5.A): page centred on a
 * slate background, card with the logo and the title. With `photoUrl` (login page), the card
 * widens on large screens: the form on the left, a decorative photo on the right, hidden on
 * phones. If the photo does not load, the hotel colours and the zellige star stay in its place.
 */
@Component({
  selector: 'adm-auth-card',
  imports: [ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-dvh items-center justify-center bg-slate-nav px-4 py-10' },
  template: `
    <main [class]="frameClass()">
      <div [class]="cardClass()">
        <div [class]="formClass()">
          <div class="mb-6 flex items-center gap-2">
            <adm-zellige-star class="size-6 text-clay" />
            <span class="font-semibold tracking-wide text-port uppercase">Riad Vieux-Port</span>
          </div>
          <h1 class="mb-6 text-xl font-semibold">{{ heading() }}</h1>
          <ng-content />
        </div>
        @if (photoUrl(); as url) {
          <div
            class="relative hidden min-h-[34rem] overflow-hidden rounded-lg bg-slate-nav md:block"
            aria-hidden="true"
          >
            <adm-zellige-star
              class="absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 text-clay"
            />
            @if (!photoFailed()) {
              <img
                class="absolute inset-0 size-full object-cover"
                [src]="url"
                alt=""
                width="1000"
                height="1400"
                decoding="async"
                referrerpolicy="no-referrer"
                (error)="photoFailed.set(true)"
              />
            }
          </div>
        }
      </div>
      <ng-content select="[afterCard]" />
    </main>
  `,
})
export class AuthCard {
  readonly heading = input.required<string>();
  /** Decorative photo beside the form, large screens only. */
  readonly photoUrl = input<string | null>(null);

  protected readonly photoFailed = signal(false);

  protected readonly frameClass = computed(() =>
    this.photoUrl() ? 'w-full max-w-md md:max-w-5xl' : 'w-full max-w-md',
  );
  protected readonly cardClass = computed(() =>
    this.photoUrl() ? 'card p-6 sm:p-8 md:grid md:grid-cols-2 md:gap-6 md:p-3' : 'card p-6 sm:p-8',
  );
  protected readonly formClass = computed(() =>
    this.photoUrl() ? 'md:self-center md:px-10 md:py-12' : '',
  );
}
