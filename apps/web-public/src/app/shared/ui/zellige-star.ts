import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Eight-pointed star inspired by zellige tiles, the visual signature of the brand. Decorative. */
@Component({
  selector: 'rvp-zellige-star',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" class="size-full" fill="currentColor" focusable="false">
      <rect x="5" y="5" width="14" height="14" />
      <rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" />
    </svg>
  `,
})
export class ZelligeStar {}
