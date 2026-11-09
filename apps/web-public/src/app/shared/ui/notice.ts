import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CircleAlert, Info, LucideAngularModule } from 'lucide-angular';

/**
 * A message in a coloured box: « danger » for a problem (announced at once to screen readers),
 * « info » for a piece of information (announced politely).
 */
@Component({
  selector: 'rvp-notice',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex gap-3 rounded-lg border-l-4 p-4',
    '[class]': 'boxClass()',
    '[attr.role]': "tone() === 'danger' ? 'alert' : 'status'",
  },
  template: `
    <lucide-icon
      class="shrink-0"
      aria-hidden="true"
      [class]="iconClass()"
      [img]="icon()"
      [size]="24"
    />
    <div class="min-w-0"><ng-content /></div>
  `,
})
export class Notice {
  readonly tone = input<'danger' | 'info'>('danger');

  protected readonly boxClass = computed(() =>
    this.tone() === 'danger' ? 'border-danger bg-danger-pale' : 'border-port bg-info-pale',
  );
  protected readonly iconClass = computed(() =>
    this.tone() === 'danger' ? 'text-danger' : 'text-port',
  );
  protected readonly icon = computed(() => (this.tone() === 'danger' ? CircleAlert : Info));
}
