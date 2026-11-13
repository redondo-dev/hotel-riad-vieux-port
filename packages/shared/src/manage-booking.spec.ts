import { describe, expect, it } from 'vitest';
import { MANAGE_BOOKING_PATHS, manageAccessOf } from './manage-booking.js';

const TOKEN = 'A'.repeat(21) + '-_' + 'z9'.repeat(10);

describe('manage booking link', () => {
  it('has the paths written by the API in the e-mails', () => {
    expect(MANAGE_BOOKING_PATHS).toEqual({ fr: 'gerer-ma-reservation', en: 'manage-my-booking' });
  });

  it('reads the reference and the token back, and refuses anything else', () => {
    expect(manageAccessOf(`#K7M2QX9A.${TOKEN}`)).toEqual({ reference: 'K7M2QX9A', token: TOKEN });
    expect(manageAccessOf(`K7M2QX9A.${TOKEN}`)).toEqual({ reference: 'K7M2QX9A', token: TOKEN });
    expect(manageAccessOf('#K7M2QX9A')).toBeNull();
    expect(manageAccessOf(`#K7M2QX9I.${TOKEN}`)).toBeNull();
    expect(manageAccessOf(`#K7M2QX9A.${TOKEN}x`)).toBeNull();
    expect(manageAccessOf('')).toBeNull();
  });
});
