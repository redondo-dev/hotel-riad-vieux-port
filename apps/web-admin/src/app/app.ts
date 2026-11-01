import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
export class App {}
