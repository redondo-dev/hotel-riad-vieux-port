/**
 * Pure rules of the photos of the categories (module « Photos »): what is accepted, the stored
 * versions and their public addresses. The image itself is read and converted elsewhere.
 */

/** Largest file accepted: a photo from a phone or from Unsplash fits. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Beyond this, a page of a category becomes slow and the choice is not edited any more. */
export const MAX_PHOTOS_PER_CATEGORY = 12;

/** Formats read (from the content of the file, never from its name). */
export const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp'] as const;

/** Widths stored, in pixels: thumbnail, card, full screen. Always WebP. */
export const PHOTO_WIDTHS = [400, 800, 1600] as const;
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];

/** Where the public site reads the files (served by the API, cached for a year). */
export const MEDIA_PATH = '/api/v1/public/media';

/** « photos/<id>-800.webp »: the key of one stored version. */
export function photoKey(photoId: string, width: PhotoWidth): string {
  return `photos/${photoId}-${width}.webp`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** File names the public address accepts: « <uuid>-800.webp », nothing else. */
export const MEDIA_FILE = new RegExp(`^(${UUID})-(${PHOTO_WIDTHS.join('|')})\\.webp$`);

export interface PhotoSource {
  width: PhotoWidth;
  url: string;
}

/** The three versions of a photo, smallest first (for a « srcset »). */
export function photoSources(photoId: string): PhotoSource[] {
  return PHOTO_WIDTHS.map((width) => ({ width, url: `${MEDIA_PATH}/${photoId}-${width}.webp` }));
}

/** The new order must name every photo of the category, once each. */
export function orderProblem(current: readonly string[], wanted: readonly string[]): string | null {
  const known = new Set(current);
  const unique = new Set(wanted);
  if (unique.size !== wanted.length) {
    return 'Une photo apparaît deux fois.';
  }
  if (wanted.length !== current.length || wanted.some((id) => !known.has(id))) {
    return 'L’ordre doit reprendre toutes les photos de la catégorie, et seulement elles.';
  }
  return null;
}
