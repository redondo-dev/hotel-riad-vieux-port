import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import {
  type AvailabilityAnswer,
  type CustomerChoice,
  type Occupancy,
  serializeGuests,
} from './booking-model';
import type {
  CancellationQuote,
  ChangePreview,
  FreeRoom,
  RatePlan,
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

/** A desk or phone booking; an existing customer (`customerId`) or a new one, never both. */
export interface NewBooking {
  checkIn: string;
  checkOut: string;
  ratePlan: RatePlan;
  source: 'phone' | 'desk';
  rooms: { categoryId: string; adults: number; childrenAges: number[]; babyCot: boolean }[];
  services: { serviceId: string; quantity: number }[];
  customerId?: string;
  newCustomer?: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    preferredLanguage: 'fr' | 'en';
  };
  customerMessage?: string;
  internalNotes?: string;
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
  private readonly root = inject(ADMIN_API);
  private readonly base = `${this.root}/reservations`;

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

  /** Rooms left and prices of a stay; nothing is held. */
  availability(checkIn: string, checkOut: string, rooms: Occupancy[]): Promise<AvailabilityAnswer> {
    const params = { checkIn, checkOut, guests: serializeGuests(rooms) };
    const url = `${this.root}/availability`;
    return firstValueFrom(this.http.get<AvailabilityAnswer>(url, { params }));
  }

  /** Customers whose name or e-mail contains `text` (10 at most). */
  async customers(text: string): Promise<CustomerChoice[]> {
    const params = { q: text };
    const url = `${this.root}/customers`;
    const result = await firstValueFrom(this.http.get<Items<CustomerChoice>>(url, { params }));
    return result.items;
  }

  /**
   * `key` stays the same for the whole form: a double click, or a retry after a network cut,
   * creates nothing more (the API answers again what it answered the first time).
   */
  create(booking: NewBooking, key: string): Promise<ReservationDetail> {
    const headers = new HttpHeaders({ 'Idempotency-Key': key });
    return firstValueFrom(this.http.post<ReservationDetail>(this.base, booking, { headers }));
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
