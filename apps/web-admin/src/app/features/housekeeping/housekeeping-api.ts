import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type { HousekeepingRoom, HousekeepingStatus } from './housekeeping-model';

interface Board {
  items: HousekeepingRoom[];
}

interface GroupChange {
  items: HousekeepingRoom[];
  changed: number;
}

/**
 * Calls of the housekeeping (API: /api/v1/admin/housekeeping). The session cookie and the
 * anti-CSRF token are added by the interceptor; errors are turned into messages by the screen.
 */
@Injectable({ providedIn: 'root' })
export class HousekeepingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_API)}/housekeeping`;

  /** Every active room of the hotel; the screen filters them itself. */
  async rooms(): Promise<HousekeepingRoom[]> {
    const result = await firstValueFrom(this.http.get<Board>(`${this.base}/rooms`));
    return result.items;
  }

  setStatus(roomId: string, status: HousekeepingStatus): Promise<HousekeepingRoom> {
    return firstValueFrom(
      this.http.patch<HousekeepingRoom>(`${this.base}/rooms/${roomId}`, { status }),
    );
  }

  setStatusOfRooms(roomIds: string[], status: HousekeepingStatus): Promise<GroupChange> {
    return firstValueFrom(
      this.http.post<GroupChange>(`${this.base}/rooms/status`, { roomIds, status }),
    );
  }
}
