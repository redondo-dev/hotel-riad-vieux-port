import { describe, expect, it } from 'vitest';
import {
  checkoutClosesAt,
  dueNowCents,
  holdUntil,
  isSiteAddress,
  paymentStatusAfterOnlinePayment,
  publicStatusOf,
  stayDescription,
  withBookingReference,
} from './online-booking-rules.ts';

describe('online booking rules', () => {
  it('closes the payment page before the end of the hold of the rooms', () => {
    const now = new Date('2027-05-01T10:00:00Z');
    expect(checkoutClosesAt(now).toISOString()).toBe('2027-05-01T10:31:00.000Z');
    expect(holdUntil(now).toISOString()).toBe('2027-05-01T10:33:00.000Z');
  });

  it('takes the stay at once at the non-refundable rate, the tax being paid at the hotel', () => {
    expect(dueNowCents('non_refundable', 34_020 + 1500, 1500)).toBe(34_020);
    expect(dueNowCents('flexible', 37_800 + 1500, 1500)).toBe(0);
  });

  it('leaves the payment partly due while the tourist tax is to be paid at the hotel', () => {
    expect(paymentStatusAfterOnlinePayment(1500)).toBe('partially_paid');
    expect(paymentStatusAfterOnlinePayment(0)).toBe('paid');
  });

  it('describes the stay in the language of the visitor', () => {
    expect(stayDescription('Double standard', 3, 'fr')).toBe('Double standard · 3 nuits');
    expect(stayDescription('Suite', 1, 'fr')).toBe('Suite · 1 nuit');
    expect(stayDescription('Double room', 2, 'en')).toBe('Double room · 2 nights');
  });

  it('tells the visitor only whether the booking waits, is confirmed or is over', () => {
    expect(publicStatusOf('pending_payment')).toBe('pending');
    expect(publicStatusOf('confirmed')).toBe('confirmed');
    expect(publicStatusOf('checked_out')).toBe('confirmed');
    expect(publicStatusOf('expired')).toBe('cancelled');
    expect(publicStatusOf('cancelled')).toBe('cancelled');
  });

  it('adds the reference to the page « ← Retour » leads to, keeping its search', () => {
    const back = 'https://riad.example/fr/reserver/choix?guests=2';
    expect(withBookingReference(back, 'K7M2QX9A')).toBe(`${back}&booking=K7M2QX9A`);
  });

  it('accepts only addresses of the public site', () => {
    const site = 'https://riad.example';
    expect(isSiteAddress('https://riad.example/fr/reserver/confirmation', site)).toBe(true);
    expect(isSiteAddress('https://evil.example/fr', site)).toBe(false);
    expect(isSiteAddress('http://riad.example/fr', site)).toBe(false);
    expect(isSiteAddress('https://riad.example.evil.example/', site)).toBe(false);
    expect(isSiteAddress('https://user:pass@riad.example/', site)).toBe(false);
    expect(isSiteAddress('/fr/reserver', site)).toBe(false);
  });
});
