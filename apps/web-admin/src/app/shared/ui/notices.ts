import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LucideCircleAlert, LucideCircleCheck, LucideX } from '@lucide/angular';
import { NotifierService } from '../../core/notifier.service';

/** Notifications at the top right; announced politely (success) or at once (error). */
@Component({
  selector: 'adm-notices',
  imports: [LucideCircleCheck, LucideCircleAlert, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fixed top-4 right-4 z-40 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2' },
  template: `
    <div aria-live="polite" class="flex flex-col gap-2">
      @for (notice of successes(); track notice.id) {
        <div class="alert-success shadow-pop">
          <svg lucideCircleCheck class="mt-0.5 shrink-0 text-success"></svg>
          <p class="flex-1">{{ notice.text }}</p>
          <button type="button" class="-m-2 btn-icon size-9" (click)="notifier.dismiss(notice.id)">
            <svg lucideX></svg>
            <span class="sr-only">Fermer la notification</span>
          </button>
        </div>
      }
    </div>
    <div role="alert" class="flex flex-col gap-2">
      @for (notice of errors(); track notice.id) {
        <div class="alert-error shadow-pop">
          <svg lucideCircleAlert class="mt-0.5 shrink-0 text-danger"></svg>
          <p class="flex-1">{{ notice.text }}</p>
          <button type="button" class="-m-2 btn-icon size-9" (click)="notifier.dismiss(notice.id)">
            <svg lucideX></svg>
            <span class="sr-only">Fermer la notification</span>
          </button>
        </div>
      }
    </div>
  `,
})
export class Notices {
  protected readonly notifier = inject(NotifierService);
  protected readonly successes = computed(() =>
    this.notifier.notices().filter((notice) => notice.kind === 'success'),
  );
  protected readonly errors = computed(() =>
    this.notifier.notices().filter((notice) => notice.kind === 'error'),
  );
}
