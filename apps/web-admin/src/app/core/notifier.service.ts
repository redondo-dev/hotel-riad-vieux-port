import { Injectable, signal } from '@angular/core';

export interface Notice {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

/**
 * Notifications at the top right (UI/UX specification, section 5): a success disappears after
 * 5 seconds, an error stays until closed. Announced to screen readers by the Notices component.
 */
@Injectable({ providedIn: 'root' })
export class NotifierService {
  private nextId = 1;
  private readonly items = signal<Notice[]>([]);
  readonly notices = this.items.asReadonly();

  success(text: string): void {
    const id = this.push('success', text);
    setTimeout(() => {
      this.dismiss(id);
    }, 5000);
  }

  error(text: string): void {
    this.push('error', text);
  }

  dismiss(id: number): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  private push(kind: Notice['kind'], text: string): number {
    const id = this.nextId;
    this.nextId += 1;
    this.items.update((items) => [...items, { id, kind, text }]);
    return id;
  }
}
