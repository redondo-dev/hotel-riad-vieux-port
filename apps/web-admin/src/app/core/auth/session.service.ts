import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ADMIN_API } from '../api/api';
import { menuFor, type StaffUser } from './roles';

interface SessionView {
  user: StaffUser;
  csrfToken: string;
}

/**
 * The logged-in staff member, shared by the whole tool. The session itself lives on the server
 * (HttpOnly cookie, unreadable here); this service only keeps who is logged in and the anti-CSRF
 * token, read again from the server when the tool opens.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ADMIN_API);

  private readonly currentUser = signal<StaffUser | null>(null);
  private csrfToken: string | null = null;
  private loading: Promise<StaffUser | null> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly menu = computed(() => {
    const user = this.currentUser();
    return user === null ? [] : menuFor(user.role);
  });

  /** Token to send in X-CSRF-Token with every change. */
  csrf(): string | null {
    return this.csrfToken;
  }

  /** Asks the server once whether a session is open (then answers from memory). */
  ensureLoaded(): Promise<StaffUser | null> {
    this.loading ??= this.fetchSession();
    return this.loading;
  }

  async logIn(email: string, password: string): Promise<StaffUser> {
    const view = await firstValueFrom(
      this.http.post<SessionView>(`${this.api}/session`, { email, password }),
    );
    this.apply(view);
    return view.user;
  }

  async logOut(): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<void>(`${this.api}/session`));
    } finally {
      this.clear();
    }
  }

  /** Forgets the session locally (after a logout or when the server says it has expired). */
  clear(): void {
    this.currentUser.set(null);
    this.csrfToken = null;
    this.loading = Promise.resolve(null);
  }

  private apply(view: SessionView): void {
    this.currentUser.set(view.user);
    this.csrfToken = view.csrfToken;
    this.loading = Promise.resolve(view.user);
  }

  private async fetchSession(): Promise<StaffUser | null> {
    try {
      const view = await firstValueFrom(this.http.get<SessionView>(`${this.api}/session`));
      this.apply(view);
      return view.user;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.clear();
        return null;
      }
      // Server unreachable: ask again next time instead of remembering the failure.
      this.loading = null;
      throw error;
    }
  }
}
