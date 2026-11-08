import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PhotoView } from '../../core/data/photo-view';
import { ZelligeStar } from './zellige-star';

/**
 * Photo with an honest placeholder. As long as no royalty-free photo has been chosen, it
 * shows a decorated block labelled "Photo à venir" instead of a fake picture. The text
 * alternative is always the one of the intended photo. A photo of the catalogue comes in
 * several sizes (« srcset »): the browser downloads only the one it needs.
 */
@Component({
  selector: 'rvp-photo',
  imports: [ZelligeStar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-hidden' },
  template: `
    @if (photo(); as picture) {
      <img
        class="size-full object-cover"
        decoding="async"
        [src]="picture.src"
        [attr.srcset]="picture.srcset"
        [attr.sizes]="sizes()"
        [attr.width]="picture.width"
        [attr.height]="picture.height"
        [attr.loading]="eager() ? null : 'lazy'"
        [attr.fetchpriority]="eager() ? 'high' : null"
        [alt]="picture.alt"
      />
    } @else if (src(); as source) {
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
  /** Text of the placeholder, or of `src`; a `photo` has its own. */
  readonly alt = input.required<string>();
  readonly src = input<string | null>(null);
  /** A photo of the catalogue, in several sizes. */
  readonly photo = input<PhotoView | null>(null);
  /** How wide the photo is displayed, so that the browser downloads the right size. */
  readonly sizes = input('100vw');
  /** For the first photo seen on a page: loaded at once rather than when scrolled to. */
  readonly eager = input(false);
  readonly tone = input<'light' | 'dark'>('light');
}
