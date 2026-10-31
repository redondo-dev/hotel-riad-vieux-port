import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { LucideAngularModule, Minus, Plus } from 'lucide-angular';

/**
 * Number picker with − and + buttons. At the limits the buttons are marked `aria-disabled`
 * rather than `disabled`, so keyboard focus is never lost.
 */
@Component({
  selector: 'rvp-counter',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center justify-between gap-4"
      role="group"
      [attr.aria-labelledby]="labelId()"
    >
      <span [id]="labelId()" class="text-base text-ink">{{ label() }}</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn-icon border border-field"
          [attr.aria-label]="decrementLabel()"
          [attr.aria-disabled]="value() <= min() || null"
          (click)="change(-1)"
        >
          <lucide-icon [img]="icons.minus" [size]="18" aria-hidden="true" />
        </button>
        <output class="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{{
          value()
        }}</output>
        <button
          type="button"
          class="btn-icon border border-field"
          [attr.aria-label]="incrementLabel()"
          [attr.aria-disabled]="value() >= max() || null"
          (click)="change(1)"
        >
          <lucide-icon [img]="icons.plus" [size]="18" aria-hidden="true" />
        </button>
      </div>
    </div>
  `,
})
export class Counter {
  readonly label = input.required<string>();
  readonly labelId = input.required<string>();
  readonly decrementLabel = input.required<string>();
  readonly incrementLabel = input.required<string>();
  readonly min = input(0);
  readonly max = input(10);
  readonly value = model.required<number>();

  protected readonly icons = { minus: Minus, plus: Plus };

  protected change(step: number): void {
    const next = this.value() + step;
    if (next >= this.min() && next <= this.max()) {
      this.value.set(next);
    }
  }
}
