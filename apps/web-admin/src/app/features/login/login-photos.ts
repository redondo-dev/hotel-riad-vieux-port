/**
 * Photo behind the login page: one of a short list of Picsum photos (sea, sky, landscapes,
 * checked by hand so that nothing odd appears), drawn at each display of the page. Picsum is an
 * outside service: the photo is only decoration, the login works without it.
 */

export const LOGIN_PHOTO_IDS = [1015, 1016, 1018, 1036, 1039, 1043, 1067, 15, 28, 29] as const;

/** Landscape, the size of a large screen. */
const WIDTH = 1920;
const HEIGHT = 1080;

/** One of the photos of the list, drawn with `random` (a number from 0 to 1, 1 excluded). */
export function pickLoginPhoto(random: () => number = Math.random): number {
  const index = Math.min(Math.floor(random() * LOGIN_PHOTO_IDS.length), LOGIN_PHOTO_IDS.length - 1);
  return LOGIN_PHOTO_IDS[index] ?? LOGIN_PHOTO_IDS[0];
}

export function loginPhotoUrl(id: number): string {
  return `https://picsum.photos/id/${id}/${WIDTH}/${HEIGHT}`;
}
