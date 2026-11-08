/**
 * Photo files on the public site. The API stores each photo in three WebP versions; the server
 * of the site relays them under « /media/<file> », so that the visitor's browser only ever talks
 * to the site (the API stays internal).
 */

/** Where the public site serves the photo files. */
export const MEDIA_PATH = '/media';

/** The only file names accepted: « <uuid>-<400|800|1600>.webp ». */
export const MEDIA_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?:400|800|1600)\.webp$/;

/** « /media/<file> »: the address of a photo file on the public site. */
export function mediaUrl(file: string): string {
  return `${MEDIA_PATH}/${file}`;
}
