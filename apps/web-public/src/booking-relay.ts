/**
 * Relay of the booking routes of the API (decision of 8 November 2026, « 1a »): the visitor's
 * browser only talks to the site; the server of the site calls the API, which stays internal.
 *
 * Only what is expected is passed on: three parameters of a fixed shape, never any other. The
 * visitor's address goes with the call (X-Forwarded-For), so that the limit of 30 searches per
 * minute of the API counts each visitor rather than the site (the API needs TRUST_PROXY=1).
 */

/** Address of the relay on the site, for the visitor's browser. */
export const AVAILABILITY_RELAY_PATH = '/reservation-api/availability';

export interface BookingRelayOptions {
  /** Address of the public API, for example http://localhost:3000/api/v1. */
  apiUrl: string;
  /** Replaced in the tests. */
  fetch?: typeof fetch;
  /** Called when the API could not be read (logged, never shown to visitors). */
  onError?: (error: unknown) => void;
  timeoutMs?: number;
}

/** The parameters of a search, as in the addresses of the site. */
export interface AvailabilityQuery {
  checkIn: string;
  checkOut: string;
  guests: string;
}

/** The status and the body of the API, or 502 when it did not answer as expected. */
export interface RelayAnswer {
  status: number;
  body: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GUESTS = /^[0-9_-]{1,60}$/;

/** Answers of the API passed on as they are; anything else becomes 502. */
const PASSED_STATUSES = new Set([200, 400, 429, 503]);

const INVALID: RelayAnswer = { status: 400, body: { code: 'VALIDATION_FAILED' } };
const UNREACHABLE: RelayAnswer = { status: 502, body: { code: 'API_UNREACHABLE' } };

/** The query of the site, or null when a parameter is missing or of an unexpected shape. */
export function availabilityQueryOf(read: (name: string) => unknown): AvailabilityQuery | null {
  const checkIn = read('checkIn');
  const checkOut = read('checkOut');
  const guests = read('guests');
  if (
    typeof checkIn !== 'string' ||
    typeof checkOut !== 'string' ||
    typeof guests !== 'string' ||
    !ISO_DATE.test(checkIn) ||
    !ISO_DATE.test(checkOut) ||
    !GUESTS.test(guests)
  ) {
    return null;
  }
  return { checkIn, checkOut, guests };
}

export class BookingRelay {
  readonly #apiUrl: string;
  readonly #fetch: typeof fetch;
  readonly #onError: (error: unknown) => void;
  readonly #timeoutMs: number;

  constructor(options: BookingRelayOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    // Wrapped: the global fetch must not be called as a method of another object.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#onError = options.onError ?? (() => undefined);
    this.#timeoutMs = options.timeoutMs ?? 5000;
  }

  /** `query` null: refused here, the API is not called. */
  async availability(
    query: AvailabilityQuery | null,
    visitorIp: string | undefined,
  ): Promise<RelayAnswer> {
    if (query === null) {
      return INVALID;
    }
    const search = new URLSearchParams({ ...query }).toString();
    try {
      const response = await this.#fetch(`${this.#apiUrl}/public/availability?${search}`, {
        headers: visitorIp === undefined ? {} : { 'X-Forwarded-For': visitorIp },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!PASSED_STATUSES.has(response.status)) {
        throw new Error(`réponse ${response.status} de l’API des disponibilités`);
      }
      return { status: response.status, body: (await response.json()) as unknown };
    } catch (error) {
      this.#onError(error);
      return UNREACHABLE;
    }
  }
}
