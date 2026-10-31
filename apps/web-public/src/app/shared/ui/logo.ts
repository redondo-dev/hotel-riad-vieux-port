import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ZelligeStar } from './zellige-star';

/** Typographic logo: terracotta star + name in Fraunces. The brand name is not translated. */
@Component({
  selector: 'rvp-logo',
  imports: [ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2' },
  template: `
    <rvp-zellige-star class="size-6 shrink-0 text-clay" />
    <span
      class="font-display text-lg font-semibold tracking-[0.04em] uppercase"
      [class.text-port]="tone() === 'on-light'"
      [class.text-white]="tone() === 'on-dark'"
      >Riad Vieux-Port</span
    >
  `,
})
export class Logo {
  readonly tone = input<'on-light' | 'on-dark'>('on-light');
}
