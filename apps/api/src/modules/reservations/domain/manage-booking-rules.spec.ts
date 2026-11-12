import { describe, expect, it } from 'vitest';
import {
  MANAGE_TOKEN_PATTERN,
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
