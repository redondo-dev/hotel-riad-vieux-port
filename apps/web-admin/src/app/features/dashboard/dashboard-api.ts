import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type { Dashboard } from './dashboard-model';

/** The dashboard of the management (API: /api/v1/admin/dashboard), read only. */
@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(ADMIN_API)}/dashboard`;

  /** The figures of today and of its month. */
  dashboard(): Promise<Dashboard> {
    return firstValueFrom(this.http.get<Dashboard>(this.url));
  }
}
