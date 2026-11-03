import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type { ReservationDetail } from '../reservations/reservation-model';
import type { FrontDeskDay } from './front-desk-model';

/** What the reception ticked at the arrival, and a dirty room given all the same. */
export interface CheckInChecks {
  identityChecked: boolean;
  policeFormDone: boolean;
  acceptDirtyRoom: boolean;
}

/**
 * Calls of the front desk (API: /api/v1/admin/front-desk and the actions of a reservation). Each
 * action sends the version read (If-Match): a change made meanwhile by a colleague gives a 412.
 */
@Injectable({ providedIn: 'root' })
export class FrontDeskApi {
  private readonly http = inject(HttpClient);
  private readonly root = inject(ADMIN_API);

  day(date: string): Promise<FrontDeskDay> {
    const url = `${this.root}/front-desk`;
    return firstValueFrom(this.http.get<FrontDeskDay>(url, { params: { date } }));
  }

  checkIn(id: string, version: number, checks: CheckInChecks): Promise<ReservationDetail> {
    return this.act(id, version, 'check-in', checks);
  }

  checkOut(id: string, version: number): Promise<ReservationDetail> {
    return this.act(id, version, 'check-out', {});
  }

  noShow(id: string, version: number): Promise<ReservationDetail> {
    return this.act(id, version, 'no-show', {});
  }

  private act(
    id: string,
    version: number,
    action: string,
    body: object,
  ): Promise<ReservationDetail> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    const url = `${this.root}/reservations/${id}/${action}`;
    return firstValueFrom(this.http.post<ReservationDetail>(url, body, { headers }));
  }
}
