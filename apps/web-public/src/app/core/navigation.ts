/**
 * Localised route paths and public navigation.
 *
 * Paths go through `$localize`: the French build serves `/fr/reserver`, the English build
 * `/en/book`. A page only appears in the menus once it exists (`available: true`), so the
 * site never shows a link that leads nowhere.
 */

export const BOOKING_PATH = $localize`:@@route.booking:reserver`;

/** `/fr/reserver/choix`: the rate chosen, before the guest's details (step R-4). */
export const CHOICE_PATH = $localize`:@@route.bookingChoice:choix`;

/** `/fr/chambres/<code>`, `/en/rooms/<code>`: the page of a room category. */
export const ROOMS_PATH = $localize`:@@route.rooms:chambres`;

/** Id of the stay search section, target of every "Book" button. */
export const SEARCH_ANCHOR = 'search';

export interface NavItem {
  label: string;
  path: string;
  available: boolean;
}

export const PUBLIC_NAV: NavItem[] = [
  {
    label: $localize`:@@nav.hotel:L'hôtel`,
    path: $localize`:@@route.hotel:hotel`,
    available: false,
  },
  {
    label: $localize`:@@nav.rooms:Chambres`,
    path: ROOMS_PATH,
    available: false,
  },
  {
    label: $localize`:@@nav.neighbourhood:Quartier`,
    path: $localize`:@@route.neighbourhood:quartier`,
    available: false,
  },
  {
    label: $localize`:@@nav.faq:FAQ`,
    path: $localize`:@@route.faq:faq`,
    available: false,
  },
  {
    label: $localize`:@@nav.contact:Contact`,
    path: $localize`:@@route.contact:contact`,
    available: false,
  },
];
