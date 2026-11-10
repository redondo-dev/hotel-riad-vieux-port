/**
 * A booking sent from the site (step R-4): what the API answers, read field by field. Pure: the
 * calls themselves are made by the pages, through the relay of the site.
 */

/** The only address the visitor's browser is sent to for the payment. */
export const STRIPE_CHECKOUT_PREFIX = 'https://checkout.stripe.com/';

export type BookingAnswer =
  /** The payment page is ready: the browser goes there. */
  | { kind: 'redirect'; url: string }
  /** The room was booked by someone else meanwhile. */
  | { kind: 'gone' }
  /** Fields refused by the API, by name of the form field (« firstName », « acceptTerms »…). */
  | { kind: 'invalid'; fields: Record<string, string> }
  /** Too many bookings from this visitor (429), or the same booking still in progress. */
  | { kind: 'busy' }
  /** API or payment service unavailable, or an unexpected answer. */
  | { kind: 'unavailable' };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** « customer.firstName » → « firstName »: the form does not show the shape of the API. */
function formFieldOf(field: string): string {
  return field.startsWith('customer.') ? field.slice('customer.'.length) : field;
}

function fieldErrorsOf(body: unknown): Record<string, string> {
  const errors = isFields(body) && Array.isArray(body['errors']) ? body['errors'] : [];
  const fields: Record<string, string> = {};
  for (const error of errors) {
    if (isFields(error) && typeof error['field'] === 'string') {
      const message = typeof error['message'] === 'string' ? error['message'] : '';
      fields[formFieldOf(error['field'])] = message;
    }
  }
  return fields;
}

export function bookingAnswerOf(answer: { status: number; body: unknown }): BookingAnswer {
  const { status, body } = answer;
  if (status === 201 && isFields(body)) {
    const url = body['checkoutUrl'];
    return typeof url === 'string' && url.startsWith(STRIPE_CHECKOUT_PREFIX)
      ? { kind: 'redirect', url }
      : { kind: 'unavailable' };
  }
  const code = isFields(body) ? body['code'] : undefined;
  if (status === 409 && code === 'NO_LONGER_AVAILABLE') {
    return { kind: 'gone' };
  }
  if (status === 409 || status === 429) {
    return { kind: 'busy' };
  }
  if (status === 400) {
    return { kind: 'invalid', fields: fieldErrorsOf(body) };
  }
  return { kind: 'unavailable' };
}

/** A booking of the website as its confirmation page shows it: no personal data. */
export interface BookingSummary {
  reference: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  checkIn: string;
  checkOut: string;
  category: string | null;
  roomCount: number;
  ratePlan: 'flexible' | 'non_refundable';
  paidOnlineCents: number;
  dueAtHotelCents: number;
}

const STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
const RATE_PLANS = ['flexible', 'non_refundable'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** null for an answer of an unexpected shape. */
export function bookingSummaryOf(body: unknown): BookingSummary | null {
  if (!isFields(body)) {
    return null;
  }
  const { reference, status, checkIn, checkOut, category, roomCount, ratePlan } = body;
  const { paidOnlineCents, dueAtHotelCents } = body;
  const foundStatus = STATUSES.find((item) => item === status);
  const foundRatePlan = RATE_PLANS.find((item) => item === ratePlan);
  if (
    typeof reference !== 'string' ||
    foundStatus === undefined ||
    foundRatePlan === undefined ||
    typeof checkIn !== 'string' ||
    !ISO_DATE.test(checkIn) ||
    typeof checkOut !== 'string' ||
    !ISO_DATE.test(checkOut) ||
    !(category === null || typeof category === 'string') ||
    !isAmount(roomCount) ||
    !isAmount(paidOnlineCents) ||
    !isAmount(dueAtHotelCents)
  ) {
    return null;
  }
  return {
    reference,
    status: foundStatus,
    checkIn,
    checkOut,
    category,
    roomCount,
    ratePlan: foundRatePlan,
    paidOnlineCents,
    dueAtHotelCents,
  };
}
