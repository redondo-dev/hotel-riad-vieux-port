import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../../core/api/api';
import type {
  Incident,
  IncidentDetail,
  IncidentPriority,
  IncidentStatus,
  PersonName,
  RoomChoice,
} from './incident-model';

export interface IncidentFilter {
  status?: IncidentStatus;
  priority?: IncidentPriority;
  mine?: boolean;
  includeClosed?: boolean;
}

export interface NewIncident {
  roomId: string | null;
  location: string | null;
  title: string;
  description: string;
  priority: IncidentPriority;
  blocksRoom: boolean;
}

interface Items<T> {
  items: T[];
}

/**
 * Calls of the incidents (API: /api/v1/admin/incidents). The session cookie and the anti-CSRF
 * token are added by the interceptor; errors are turned into messages by the screens.
 */
@Injectable({ providedIn: 'root' })
export class IncidentApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_API)}/incidents`;

  async list(filter: IncidentFilter): Promise<Incident[]> {
    const params: Record<string, string> = {};
    if (filter.status !== undefined) {
      params['status'] = filter.status;
    }
    if (filter.priority !== undefined) {
      params['priority'] = filter.priority;
    }
    if (filter.mine === true) {
      params['mine'] = 'true';
    }
    if (filter.includeClosed === true) {
      params['includeClosed'] = 'true';
    }
    const result = await firstValueFrom(this.http.get<Items<Incident>>(this.base, { params }));
    return result.items;
  }

  detail(id: string): Promise<IncidentDetail> {
    return firstValueFrom(this.http.get<IncidentDetail>(`${this.base}/${id}`));
  }

  async rooms(): Promise<RoomChoice[]> {
    const result = await firstValueFrom(this.http.get<Items<RoomChoice>>(`${this.base}/rooms`));
    return result.items;
  }

  async technicians(): Promise<PersonName[]> {
    const result = await firstValueFrom(
      this.http.get<Items<PersonName>>(`${this.base}/technicians`),
    );
    return result.items;
  }

  report(incident: NewIncident): Promise<IncidentDetail> {
    return firstValueFrom(this.http.post<IncidentDetail>(this.base, incident));
  }

  changeStatus(
    id: string,
    status: IncidentStatus,
    comment: string | null,
  ): Promise<IncidentDetail> {
    return firstValueFrom(
      this.http.post<IncidentDetail>(`${this.base}/${id}/status`, { status, comment }),
    );
  }

  assign(
    id: string,
    assignedTo: string | null,
    externalContractor: string | null,
  ): Promise<IncidentDetail> {
    return firstValueFrom(
      this.http.post<IncidentDetail>(`${this.base}/${id}/assignment`, {
        assignedTo,
        externalContractor,
      }),
    );
  }

  comment(id: string, comment: string): Promise<IncidentDetail> {
    return firstValueFrom(
      this.http.post<IncidentDetail>(`${this.base}/${id}/comments`, { comment }),
    );
  }
}
