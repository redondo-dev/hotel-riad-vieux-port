import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideCircle, LucideCircleCheck } from '@lucide/angular';
import { passwordChecks } from '../../core/auth/password-rules';

/** Rules of the new password, ticked live as the person types. */
@Component({
  selector: 'adm-password-rules-list',
  imports: [LucideCircle, LucideCircleCheck],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex flex-col gap-1 text-sm" [attr.id]="listId()">
      @for (check of checks(); track check.id) {
        <li class="flex items-center gap-2" [class.text-success]="check.met">
          @if (check.met) {
            <svg lucideCircleCheck [size]="16"></svg>
          } @else {
            <svg lucideCircle [size]="16" class="text-field"></svg>
          }
          <span>
            {{ check.label }}
            <span class="sr-only">{{ check.met ? ' : respecté' : ' : pas encore respecté' }}</span>
          </span>
        </li>
      }
    </ul>
  `,
})
export class PasswordRulesList {
  readonly password = input.required<string>();
  readonly confirmation = input.required<string>();
  readonly listId = input<string>('regles-mot-de-passe');

  protected readonly checks = computed(() => passwordChecks(this.password(), this.confirmation()));
}
