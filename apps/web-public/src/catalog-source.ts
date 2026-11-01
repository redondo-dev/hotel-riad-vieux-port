import { type CatalogSnapshot, parseCatalogSnapshot } from '@riad/shared';

/**
 * Catalogue of the public site, read from the API by the SERVER of the site (never by the
 * visitor's browser: the API can stay internal, and no cross-origin call is needed).
 *
 * Kept in memory (decision of 1 November 2026, « dernières données connues »):
 *  - fresh for 1 minute: no call to the API during that time;
 *  - then read again from the API; if the API does not answer, the last data received is
 *    still used for up to 24 hours, so that a short outage of the API does not take the site
 *    down;
 *  - null when nothing usable was ever received: the pages then say the site is unavailable.
 */

export interface CatalogSourceOptions {
  /** Address of the public API, for example http://localhost:3000/api/v1. */
  apiUrl: string;
  /** Replaced in the tests. */
  fetch?: typeof fetch;
  now?: () => number;
  /** Called when the API could not be read (the error is logged, never shown to visitors). */
  onError?: (error: unknown) => void;
  freshMs?: number;
  staleMs?: number;
  timeoutMs?: number;
}

const DEFAULTS = {
  freshMs: 60_000,
  staleMs: 24 * 60 * 60_000,
  timeoutMs: 3000,
};

interface Entry {
  snapshot: CatalogSnapshot;
  receivedAt: number;
}

export class CatalogSource {
  readonly #apiUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;
  readonly #freshMs: number;
  readonly #staleMs: number;
  readonly #timeoutMs: number;

  #last: Entry | null = null;
  /** One single reading at a time, shared by the requests that arrive meanwhile. */
  #reading: Promise<CatalogSnapshot | null> | null = null;

  constructor(options: CatalogSourceOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    // Wrapped: the global fetch must not be called as a method of another object.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => undefined);
    this.#freshMs = options.freshMs ?? DEFAULTS.freshMs;
    this.#staleMs = options.staleMs ?? DEFAULTS.staleMs;
    this.#timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  }

  /** The catalogue to display, or null when the site cannot display one. */
  get(): Promise<CatalogSnapshot | null> {
    const last = this.#last;
    if (last !== null && this.#now() - last.receivedAt < this.#freshMs) {
      return Promise.resolve(last.snapshot);
    }
    this.#reading ??= this.#refresh().finally(() => {
      this.#reading = null;
    });
    return this.#reading;
  }

  async #refresh(): Promise<CatalogSnapshot | null> {
    try {
      const [hotel, categories, services] = await Promise.all([
        this.#read('/public/hotel'),
        this.#read('/public/room-categories'),
        this.#read('/public/services'),
      ]);
      const snapshot = parseCatalogSnapshot(hotel, categories, services, new Date(this.#now()));
      this.#last = { snapshot, receivedAt: this.#now() };
      return snapshot;
    } catch (error) {
      this.#onError(error);
      const last = this.#last;
      if (last !== null && this.#now() - last.receivedAt < this.#staleMs) {
        return last.snapshot;
      }
      return null;
    }
  }

  async #read(path: string): Promise<unknown> {
    const response = await this.#fetch(`${this.#apiUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`l’API du catalogue a répondu ${response.status} sur ${path}`);
    }
    return response.json();
  }
}
