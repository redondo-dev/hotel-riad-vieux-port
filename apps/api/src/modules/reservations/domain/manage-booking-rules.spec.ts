import { describe, expect, it } from 'vitest';
import {
  MANAGE_BOOKING_PATHS,
  MANAGE_TOKEN_PATTERN,
  manageBookingUrl,
  manageTokenHash,
  newManageToken,
  onlineCancellation,
} from './manage-booking-rules.ts';

const DEADLINE = new Date('2037-07-08T13:00:00Z');

describe('manage link', () => {
  it('makes a new random token each time, of 43 characters, stored as its fingerprint', () => {
    const first = newManageToken();
    const second = newManageToken();

    expect(first.token).toMatch(MANAGE_TOKEN_PATTERN);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(manageTokenHash(first.token));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).not.toContain(first.token);
  });
});

describe('onlineCancellation', () => {
  const flexible = {
    status: 'confirmed' as const,
    ratePlan: 'flexible' as const,
    freeCancellationUntil: DEADLINE,
  };

  it('lets the customer cancel a flexible stay himself until the deadline only', () => {
    expect(onlineCancellation({ ...flexible, now: new Date('2037-07-08T12:59:59Z') })).toBe('free');
    expect(onlineCancellation({ ...flexible, now: DEADLINE })).toBe('free');
    expect(onlineCancellation({ ...flexible, now: new Date('2037-07-08T13:00:01Z') })).toBe(
      'with_fee',
    );
  });

  it('never cancels online a non-refundable stay, nor a booking no longer active', () => {
    const now = new Date('2037-07-01T10:00:00Z');
    expect(
      onlineCancellation({
        status: 'confirmed',
        ratePlan: 'non_refundable',
        freeCancellationUntil: null,
        now,
      }),
    ).toBe('not_refundable');
    expect(onlineCancellation({ ...flexible, status: 'cancelled', now })).toBe('closed');
    expect(onlineCancellation({ ...flexible, status: 'checked_in', now })).toBe('closed');
    expect(onlineCancellation({ ...flexible, status: 'pending_payment', now })).toBe('closed');
  });
});

describe('manageBookingUrl', () => {
  const token = 'A'.repeat(21) + '-_' + 'z9'.repeat(10);

  it('has the paths of the page of the public site (packages/shared)', () => {
    expect(MANAGE_BOOKING_PATHS).toEqual({ fr: 'gerer-ma-reservation', en: 'manage-my-booking' });
  });

  it('points at the page of the language on the built site, the token after the #', () => {
    const url = manageBookingUrl({
      siteUrl: 'https://riad.example/',
      language: 'en',
      localePrefix: true,
      reference: 'K7M2QX9A',
      token,
    });
    expect(url).toBe(`https://riad.example/en/manage-my-booking#K7M2QX9A.${token}`);
  });

  it('points at the French page at the root on the development server', () => {
    const url = manageBookingUrl({
      siteUrl: 'http://localhost:4200',
      language: 'en',
      localePrefix: false,
      reference: 'K7M2QX9A',
      token,
    });
    expect(url).toBe(`http://localhost:4200/gerer-ma-reservation#K7M2QX9A.${token}`);
  });
});
