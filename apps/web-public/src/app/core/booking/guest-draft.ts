/**
 * The guest's details, kept in the browser tab while a booking is made (decision of
 * 10 November 2026): coming back from the payment page reloads the site, and the form must not
 * start again from nothing. Only what the form asks, never the message nor anything about the
 * card; in « sessionStorage », so it disappears with the tab, and cleared once the booking is
 * recorded. Every access is guarded: a browser may refuse the storage (private window).
 */

export interface GuestDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** ISO 3166 code, or '' when not given. */
  country: string;
}

const KEY = 'riad.booking.guest';
const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'country'] as const;
const MAX_LENGTH = 254;

/** The part of the Web Storage this needs (replaced in the tests). */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadGuestDraft(storage: DraftStorage | undefined): GuestDraft | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const fields = value as Record<string, unknown>;
    const draft: Record<string, string> = {};
    for (const field of FIELDS) {
      const text = fields[field];
      if (typeof text !== 'string' || text.length > MAX_LENGTH) {
        return null;
      }
      draft[field] = text;
    }
    return draft as unknown as GuestDraft;
  } catch {
    return null;
  }
}

export function saveGuestDraft(storage: DraftStorage | undefined, draft: GuestDraft): void {
  try {
    storage?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage refused: the form will simply start empty.
  }
}

export function clearGuestDraft(storage: DraftStorage | undefined): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** sessionStorage of the browser, or undefined (server rendering, or refused). */
export function browserSessionStorage(): DraftStorage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
