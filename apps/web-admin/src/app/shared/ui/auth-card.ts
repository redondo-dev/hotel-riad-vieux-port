import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ZelligeStar } from './zellige-star';

/**
 * Frame of the pages without session (UI/UX specification, section 5.A): page centred on a
 * slate background, white card with the logo and the title.
 */
@Component({
  selector: 'adm-auth-card',
  imports: [ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-dvh items-center justify-center bg-slate-nav px-4 py-10' },
  template: `
    <main class="w-full max-w-md">
      <div class="card p-6 sm:p-8">
        <div class="mb-6 flex items-center gap-2">
          <adm-zellige-star class="size-6 text-clay" />
          <span class="font-semibold tracking-wide text-port uppercase">Riad Vieux-Port</span>
        </div>
        <h1 class="mb-6 text-xl font-semibold">{{ heading() }}</h1>
        <ng-content />
      </div>
      <ng-content select="[afterCard]" />
    </main>
  `,
})
export class AuthCard {
  readonly heading = input.required<string>();
}
