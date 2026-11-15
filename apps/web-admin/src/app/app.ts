import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme/theme.service';
import { Notices } from './shared/ui/notices';

@Component({
  selector: 'adm-root',
  imports: [RouterOutlet, Notices],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <adm-notices />
  `,
})
export class App {
  constructor() {
    // The theme chosen applies to every page, those of the login included.
    inject(ThemeService);
  }
}
