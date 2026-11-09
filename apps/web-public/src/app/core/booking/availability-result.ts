/**
 * The answer of the availability (API: GET /public/availability, relayed by the server of the
 * site), checked field by field: an answer of an unexpected shape is treated as an outage
 * rather than half displayed.
 */

/** A category that can take the whole search; prices for all the rooms together. */
export interface Offer {
  code: string;
  /** Rooms left, only when 3 or fewer. */
  roomsLeft: number | null;
  flexibleCents: number;
  nonRefundableCents: number;
  touristTaxCents: number;
}

export interface Availability {
  nights: number;
  /** End of the free cancellation at the flexible rate (ISO instant). */
  freeCancellationUntil: string | null;
  /** In the display order chosen by the management. */
  offers: Offer[];
}

export type AvailabilityResult =
  | { kind: 'found'; availability: Availability }
  /** The API refused the search (a rule the form did not catch). */
  | { kind: 'refused' }
  /** Too many searches from this visitor (429). */
  | { kind: 'busy' }
  /** API unreachable, not configured, or an unexpected answer. */
  | { kind: 'unavailable' };

const UNAVAILABLE: AvailabilityResult = { kind: 'unavailable' };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function offerOf(value: unknown): Offer | null {
  if (!isFields(value)) {
    return null;
  }
  const { code, roomsLeft, flexibleCents, nonRefundableCents, touristTaxCents } = value;
  if (
    typeof code !== 'string' ||
    !(roomsLeft === null || isAmount(roomsLeft)) ||
    !isAmount(flexibleCents) ||
    !isAmount(nonRefundableCents) ||
    !isAmount(touristTaxCents)
  ) {
    return null;
  }
  return { code, roomsLeft, flexibleCents, nonRefundableCents, touristTaxCents };
}

function availabilityOf(body: unknown): Availability | null {
  if (!isFields(body) || !Array.isArray(body['offers'])) {
    return null;
  }
  const { nights, freeCancellationUntil } = body;
  if (!isAmount(nights) || nights === 0) {
    return null;
  }
  if (!(freeCancellationUntil === null || typeof freeCancellationUntil === 'string')) {
    return null;
  }
  const offers = body['offers'].map(offerOf);
  if (offers.some((offer) => offer === null)) {
    return null;
  }
  return { nights, freeCancellationUntil, offers: offers.filter((offer) => offer !== null) };
}

/** Status and body as passed on by the relay of the site. */
interface Answer {
  status: number;
  body: unknown;
}

export function availabilityResultOf(answer: Answer): AvailabilityResult {
  switch (answer.status) {
    case 200: {
      const availability = availabilityOf(answer.body);
      return availability === null ? UNAVAILABLE : { kind: 'found', availability };
    }
    case 400:
      return { kind: 'refused' };
    case 429:
      return { kind: 'busy' };
    default:
      return UNAVAILABLE;
  }
}
