import { MEDIA_FILE_PATTERN } from '@riad/shared';

/**
 * The photo files, relayed by the server of the site from the API (decision of 8 November
 * 2026): the visitor's browser asks the site for « /media/<file> », the server reads the file
 * from the API (which stays internal) and sends it back. Only the file names the API makes are
 * accepted, so this can never be used to reach another address of the API.
 */

export interface MediaRelayOptions {
  /** Address of the public API, for example http://localhost:3000/api/v1. */
  apiUrl: string;
  /** Replaced in the tests. */
  fetch?: typeof fetch;
  /** Called when the API could not be read (logged, never shown to visitors). */
  onError?: (error: unknown) => void;
  timeoutMs?: number;
}

export type MediaAnswer =
  | { status: 200; body: Uint8Array }
  | { status: 404 }
  /** The API did not answer as expected. */
  | { status: 502 };

export class MediaRelay {
  readonly #apiUrl: string;
  readonly #fetch: typeof fetch;
  readonly #onError: (error: unknown) => void;
  readonly #timeoutMs: number;

  constructor(options: MediaRelayOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    // Wrapped: the global fetch must not be called as a method of another object.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#onError = options.onError ?? (() => undefined);
    this.#timeoutMs = options.timeoutMs ?? 5000;
  }

  async read(file: string): Promise<MediaAnswer> {
    if (!MEDIA_FILE_PATTERN.test(file)) {
      return { status: 404 };
    }
    try {
      const response = await this.#fetch(`${this.#apiUrl}/public/media/${file}`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (response.status === 404) {
        return { status: 404 };
      }
      if (!response.ok) {
        throw new Error(`réponse ${response.status} de l’API pour ${file}`);
      }
      return { status: 200, body: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      this.#onError(error);
      return { status: 502 };
    }
  }
}
