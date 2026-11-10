/**
 * Relay of the booking routes of the API (decision of 8 November 2026, « 1a »): the visitor's
 * browser only talks to the site; the server of the site calls the API, which stays internal.
 *
 * Only what is expected is passed on: three parameters of a fixed shape, never any other. The
 * visitor's address goes with the call (X-Forwarded-For), so that the limit of 30 searches per
 * minute of the API counts each visitor rather than the site (the API needs TRUST_PROXY=1).
 */

/** Addresses of the relay on the site, for the visitor's browser. */
export const AVAILABILITY_RELAY_PATH = '/reservation-api/availability';
/**
 * POST …: a booking (JSON, header Idempotency-Key); GET …/checkout/<id>: for the confirmation
 * page; POST …/<reference>/abandon: « ← Retour » on the payment page.
 */
export const BOOKING_RELAY_PATH = '/reservation-api/bookings';

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
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const CHECKOUT_SESSION = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const REFERENCE = /^[A-HJ-NP-Z2-9]{8}$/;

/** Answers of the API passed on as they are; anything else becomes 502. */
const PASSED_STATUSES = new Set([200, 201, 400, 404, 409, 429, 503]);

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

  /** One call of the public API, with the visitor's address; 502 when it fails. */
  async #call(
    path: string,
    visitorIp: string | undefined,
    init: { method?: 'POST'; headers?: Record<string, string>; body?: string } = {},
  ): Promise<RelayAnswer> {
    try {
      const response = await this.#fetch(`${this.#apiUrl}/public${path}`, {
        ...init,
        headers: {
          ...init.headers,
          ...(visitorIp === undefined ? {} : { 'X-Forwarded-For': visitorIp }),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!PASSED_STATUSES.has(response.status)) {
        throw new Error(`réponse ${response.status} de l’API pour ${path.split('?')[0] ?? ''}`);
      }
      return { status: response.status, body: (await response.json()) as unknown };
    } catch (error) {
      this.#onError(error);
      return UNREACHABLE;
    }
  }

  /** `query` null: refused here, the API is not called. */
  availability(
    query: AvailabilityQuery | null,
    visitorIp: string | undefined,
  ): Promise<RelayAnswer> {
    if (query === null) {
      return Promise.resolve(INVALID);
    }
    return this.#call(`/availability?${new URLSearchParams({ ...query }).toString()}`, visitorIp);
  }

  /**
   * A booking: the body is passed on as JSON (the API checks every field, and refuses any
   * other); the key must have the expected shape.
   */
  book(
    body: unknown,
    idempotencyKey: string | undefined,
    visitorIp: string | undefined,
  ): Promise<RelayAnswer> {
    const isObject = typeof body === 'object' && body !== null && !Array.isArray(body);
    if (!isObject || idempotencyKey === undefined || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return Promise.resolve(INVALID);
    }
    return this.#call('/bookings', visitorIp, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  /** The booking of a payment page, for the confirmation page. */
  checkout(sessionId: string, visitorIp: string | undefined): Promise<RelayAnswer> {
    if (!CHECKOUT_SESSION.test(sessionId)) {
      return Promise.resolve(INVALID);
    }
    return this.#call(`/bookings/checkout/${sessionId}`, visitorIp);
  }

  /** « ← Retour » on the payment page: the API gives the rooms back. */
  abandon(reference: string, visitorIp: string | undefined): Promise<RelayAnswer> {
    if (!REFERENCE.test(reference)) {
      return Promise.resolve(INVALID);
    }
    return this.#call(`/bookings/${reference}/abandon`, visitorIp, { method: 'POST' });
  }
}
