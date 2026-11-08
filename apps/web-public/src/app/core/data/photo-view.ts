import { type CategoryPhoto, type Locale, mediaUrl } from '@riad/shared';

/** A photo ready to display, in the current language. */
export interface PhotoView {
  alt: string;
  /** For browsers that ignore « srcset »: the version 800 pixels wide. */
  src: string;
  /** « /media/…-400.webp 400w, … »: the browser picks the size it needs. */
  srcset: string;
  width: number | null;
  height: number | null;
}

/** Width of the version given to browsers that ignore « srcset ». */
const FALLBACK_WIDTH = 800;

/** null for a photo without any file (it would show nothing). */
export function photoViewOf(photo: CategoryPhoto, locale: Locale): PhotoView | null {
  const files = [...photo.files].sort((a, b) => a.width - b.width);
  const fallback = files.find((file) => file.width >= FALLBACK_WIDTH) ?? files.at(-1);
  if (fallback === undefined) {
    return null;
  }
  return {
    alt: photo.alt[locale],
    src: mediaUrl(fallback.file),
    srcset: files.map((file) => `${mediaUrl(file.file)} ${file.width}w`).join(', '),
    width: photo.width,
    height: photo.height,
  };
}
