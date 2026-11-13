/**
 * Page « Gérer ma réservation » of the public site (step M). The API writes the same paths in
 * the e-mails (apps/api/src/modules/reservations/domain/manage-booking-rules.ts, which cannot
 * import this package): the tests of both check them. The link is
 * « …/fr/gerer-ma-reservation#REFERENCE.token »: the part after # never reaches a server.
 */
export const MANAGE_BOOKING_PATHS = {
  fr: 'gerer-ma-reservation',
  en: 'manage-my-booking',
} as const;

export type SiteLanguage = keyof typeof MANAGE_BOOKING_PATHS;

/** Separates the reference from the token after the #. */
export const MANAGE_LINK_SEPARATOR = '.';

/** Reads « REFERENCE.token » after the #; null when it is not shaped like a link. */
export function manageAccessOf(fragment: string): { reference: string; token: string } | null {
  const match = /^#?([A-HJ-NP-Z2-9]{8})\.([A-Za-z0-9_-]{43})$/.exec(fragment);
  if (match === null) {
    return null;
  }
  const [, reference, token] = match;
  return reference === undefined || token === undefined ? null : { reference, token };
}
