import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

export type TileTone = 'blue' | 'green' | 'yellow' | 'orange';

/**
 * A coloured tile at the top of a page (step T-3): a figure, its label, a note, and the icon
 * given between the tags (put in a ring). A link with `link`; a button with `clickable`, or
 * with `pressed` when it applies a filter (true when its filter is the one applied); else
 * plain text.
 */
@Component({
  selector: 'adm-stat-tile',
  imports: [NgTemplateOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex' },
  template: `
    <ng-template #body>
      <span class="flex flex-col">
        <span class="text-3xl font-bold">{{ value() }}</span>
        <span class="font-medium">{{ label() }}</span>
        @if (note(); as text) {
          <span class="text-sm opacity-90">{{ text }}</span>
        }
      </span>
      <span class="stat-tile-icon" aria-hidden="true"><ng-content /></span>
    </ng-template>

    @if (link(); as path) {
      <a [routerLink]="path" [class]="classes()">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else if (clickable() || pressed() !== null) {
      <button
        type="button"
        [class]="classes()"
        [attr.aria-pressed]="pressed()"
        (click)="selected.emit()"
      >
        <ng-container [ngTemplateOutlet]="body" />
      </button>
    } @else {
      <div [class]="classes()">
        <ng-container [ngTemplateOutlet]="body" />
      </div>
    }
  `,
})
export class StatTile {
  readonly tone = input.required<TileTone>();
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly note = input<string | null>(null);
  readonly link = input<string | null>(null);
  readonly clickable = input(false);
  /** null: not a filter; true or false: a filter, applied or not. */
  readonly pressed = input<boolean | null>(null);

  readonly selected = output();

  protected readonly classes = computed(() => `stat-tile stat-tile-${this.tone()}`);
}
