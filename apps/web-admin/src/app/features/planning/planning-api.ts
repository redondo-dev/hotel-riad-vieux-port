import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type { Planning } from './planning-model';

/** The planning of the rooms (API: /api/v1/admin/planning), read only, every role. */
@Injectable({ providedIn: 'root' })
export class PlanningApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(ADMIN_API)}/planning`;

  /** Both days included, 31 days at most. */
  planning(from: string, to: string): Promise<Planning> {
    return firstValueFrom(this.http.get<Planning>(this.url, { params: { from, to } }));
  }
}
