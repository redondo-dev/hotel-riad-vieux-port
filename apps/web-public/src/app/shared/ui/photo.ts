import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ZelligeStar } from './zellige-star';

/**
 * Photo with an honest placeholder. As long as no royalty-free photo has been chosen, it
 * shows a decorated block labelled "Photo à venir" instead of a fake picture. The text
 * alternative is always the one of the intended photo.
 */
@Component({
  selector: 'rvp-photo',
  imports: [ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-hidden' },
  template: `
    @if (src(); as source) {
      <img [src]="source" [alt]="alt()" class="size-full object-cover" loading="lazy" />
    } @else if (tone() === 'dark') {
      <div
        role="img"
        [attr.aria-label]="alt()"
        class="relative flex size-full items-center justify-center bg-linear-to-br from-port-dark to-port"
      >
        <rvp-zellige-star class="size-40 text-white/10" />
      </div>
    } @else {
      <div
        role="img"
        [attr.aria-label]="alt()"
        class="relative flex size-full flex-col items-center justify-center gap-2 bg-linear-to-br from-stone to-clay-pale"
      >
        <rvp-zellige-star class="size-14 text-clay/30" />
        <span class="text-sm font-medium text-muted" aria-hidden="true" i18n="@@photo.placeholder"
          >Photo à venir</span
        >
      </div>
    }
  `,
})
export class Photo {
  readonly alt = input.required<string>();
  readonly src = input<string | null>(null);
  readonly tone = input<'light' | 'dark'>('light');
}
