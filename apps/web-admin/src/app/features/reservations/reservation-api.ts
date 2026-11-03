import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type {
  CancellationQuote,
  ChangePreview,
  FreeRoom,
  ReservationDetail,
  ReservationPage,
  ReservationStatus,
  SortOrder,
  Source,
} from './reservation-model';

/** A filter left out (undefined) does not narrow the list. */
export interface ReservationFilter {
  q?: string | undefined;
  status?: ReservationStatus | undefined;
  source?: Source | undefined;
  arrivalFrom?: string | undefined;
  arrivalTo?: string | undefined;
  unassigned?: boolean | undefined;
  sort: SortOrder;
  page: number;
}

/** What a change sends; a field left out keeps its value, null empties a note. */
export interface ReservationChanges {
  checkIn?: string;
  checkOut?: string;
  rooms?: { lineId: string; adults: number; childrenAges: number[]; babyCot: boolean }[];
  internalNotes?: string | null;
  customerMessage?: string | null;
  reason?: string;
}

interface Items<T> {
  items: T[];
}

/**
 * Calls of the reservations (API: /api/v1/admin/reservations). The session cookie and the
 * anti-CSRF token are added by the interceptor; errors are turned into messages by the screens.
 */
@Injectable({ providedIn: 'root' })
export class ReservationApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_API)}/reservations`;

  list(filter: ReservationFilter): Promise<ReservationPage> {
    const params: Record<string, string> = { sort: filter.sort, page: String(filter.page) };
    for (const key of ['q', 'status', 'source', 'arrivalFrom', 'arrivalTo'] as const) {
      const value = filter[key];
      if (value !== undefined && value !== '') {
        params[key] = value;
      }
    }
    if (filter.unassigned === true) {
      params['unassigned'] = 'true';
    }
    return firstValueFrom(this.http.get<ReservationPage>(this.base, { params }));
  }

  detail(id: string): Promise<ReservationDetail> {
    return firstValueFrom(this.http.get<ReservationDetail>(`${this.base}/${id}`));
  }

  /** With the version read (If-Match): a change made meanwhile by a colleague gives a 412. */
  change(id: string, version: number, changes: ReservationChanges): Promise<ReservationDetail> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    return firstValueFrom(
      this.http.patch<ReservationDetail>(`${this.base}/${id}`, changes, { headers }),
    );
  }

  /** The new price of a change, nothing saved. */
  preview(id: string, version: number, changes: ReservationChanges): Promise<ChangePreview> {
    const headers = new HttpHeaders({ 'If-Match': `"${version}"` });
    const params = { preview: 'true' };
    return firstValueFrom(
      this.http.patch<ChangePreview>(`${this.base}/${id}`, changes, { headers, params }),
    );
  }

  cancellationQuote(id: string): Promise<CancellationQuote> {
    return firstValueFrom(this.http.get<CancellationQuote>(`${this.base}/${id}/cancellation`));
  }

  cancel(id: string, reason: string, waiveFee: boolean): Promise<ReservationDetail> {
    return firstValueFrom(
      this.http.post<ReservationDetail>(`${this.base}/${id}/cancel`, { reason, waiveFee }),
    );
  }

  async freeRooms(id: string, lineId: string): Promise<FreeRoom[]> {
    const url = `${this.base}/${id}/rooms/${lineId}/free-rooms`;
    const result = await firstValueFrom(this.http.get<Items<FreeRoom>>(url));
    return result.items;
  }

  /** `roomId` null takes the room back. */
  assignRoom(id: string, lineId: string, roomId: string | null): Promise<ReservationDetail> {
    const url = `${this.base}/${id}/rooms/${lineId}/room`;
    return firstValueFrom(this.http.put<ReservationDetail>(url, { roomId }));
  }
}
