/**
 * Photo behind the pages without session (login, forgotten password, new password): one of a
 * short list of Picsum photos (sea, sky, landscapes, checked by hand so that nothing odd
 * appears), drawn at each display of a page. Picsum is an outside service: the photo is only
 * decoration, the pages work without it.
 */

export const AUTH_PHOTO_IDS = [
  1015, 1016, 1018, 1036, 1039, 1043, 1067, 15, 28, 29, 41, 43, 49, 218, 293,
] as const;

/** Landscape, the size of a large screen. */
const WIDTH = 1920;
const HEIGHT = 1080;

/** One of the photos of the list, drawn with `random` (a number from 0 to 1, 1 excluded). */
export function pickAuthPhoto(random: () => number = Math.random): number {
  const index = Math.min(Math.floor(random() * AUTH_PHOTO_IDS.length), AUTH_PHOTO_IDS.length - 1);
  return AUTH_PHOTO_IDS[index] ?? AUTH_PHOTO_IDS[0];
}

export function authPhotoUrl(id: number): string {
  return `https://picsum.photos/id/${id}/${WIDTH}/${HEIGHT}`;
}
