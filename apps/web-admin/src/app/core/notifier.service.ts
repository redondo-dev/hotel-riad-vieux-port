import { Injectable, signal } from '@angular/core';

/** A button in a notification, such as « Annuler » (step U-1). */
export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: number;
  kind: 'success' | 'error';
  text: string;
  action?: NoticeAction | undefined;
}

/**
 * Notifications at the top right (UI/UX specification, section 5): a success disappears after
 * 5 seconds, an error stays until closed. A success may carry one button, such as « Annuler »:
 * a tap runs it and closes the notification. Announced to screen readers by the Notices
 * component.
 */
@Injectable({ providedIn: 'root' })
export class NotifierService {
  private nextId = 1;
  private readonly items = signal<Notice[]>([]);
  readonly notices = this.items.asReadonly();

  success(text: string, action?: NoticeAction): void {
    const id = this.push('success', text, action);
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

  /** Runs the button of a notification, once, and closes it. */
  act(notice: Notice): void {
    this.dismiss(notice.id);
    notice.action?.run();
  }

  private push(kind: Notice['kind'], text: string, action?: NoticeAction): number {
    const id = this.nextId;
    this.nextId += 1;
    this.items.update((items) => [...items, { id, kind, text, action }]);
    return id;
  }
}
