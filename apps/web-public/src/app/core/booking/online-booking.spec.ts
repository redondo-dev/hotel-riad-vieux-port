import { describe, expect, it } from 'vitest';
import { bookingAnswerOf, bookingSummaryOf } from './online-booking';

const SUMMARY = {
  reference: 'K7M2QX9A',
  status: 'pending',
  checkIn: '2027-01-12',
  checkOut: '2027-01-15',
  category: 'double-standard',
  roomCount: 1,
  ratePlan: 'non_refundable',
  paidOnlineCents: 28_350,
  dueAtHotelCents: 1500,
};

describe('bookingAnswerOf', () => {
  it('sends the browser only to a payment page of Stripe', () => {
    const url = 'https://checkout.stripe.com/c/pay/cs_test_abc';
    expect(bookingAnswerOf({ status: 201, body: { checkoutUrl: url } })).toEqual({
      kind: 'redirect',
      url,
    });
    const elsewhere = { checkoutUrl: 'https://evil.example/pay' };
    expect(bookingAnswerOf({ status: 201, body: elsewhere }).kind).toBe('unavailable');
  });

  it('gives the refused fields by their name in the form', () => {
    const body = {
      errors: [
        { field: 'customer.phone', message: 'Numéro de téléphone invalide.' },
        { field: 'acceptTerms', message: 'Acceptez les conditions de vente pour réserver.' },
      ],
    };
    expect(bookingAnswerOf({ status: 400, body })).toEqual({
      kind: 'invalid',
      fields: {
        phone: 'Numéro de téléphone invalide.',
        acceptTerms: 'Acceptez les conditions de vente pour réserver.',
      },
    });
  });

  it('tells a room taken meanwhile, too many tries and an outage apart', () => {
    const gone = { status: 409, body: { code: 'NO_LONGER_AVAILABLE' } };
    expect(bookingAnswerOf(gone).kind).toBe('gone');
    expect(bookingAnswerOf({ status: 409, body: { code: 'BOOKING_IN_PROGRESS' } }).kind).toBe(
      'busy',
    );
    expect(bookingAnswerOf({ status: 429, body: {} }).kind).toBe('busy');
    expect(bookingAnswerOf({ status: 503, body: {} }).kind).toBe('unavailable');
    expect(bookingAnswerOf({ status: 502, body: null }).kind).toBe('unavailable');
  });
});

describe('bookingSummaryOf', () => {
  it('reads the summary of a booking', () => {
    expect(bookingSummaryOf(SUMMARY)).toEqual(SUMMARY);
  });

  it('refuses an answer of an unexpected shape', () => {
    expect(bookingSummaryOf({ ...SUMMARY, status: 'paid' })).toBeNull();
    expect(bookingSummaryOf({ ...SUMMARY, checkIn: '12/01/2027' })).toBeNull();
    expect(bookingSummaryOf({ ...SUMMARY, paidOnlineCents: -1 })).toBeNull();
    expect(bookingSummaryOf(null)).toBeNull();
  });
});
