import type { PhotoView } from './photo-view';
import { SITE_PHOTO_FILES, type SitePhotoFiles } from './site-photos.generated';

/** The fixed photos of the home page, made by « npm run images:site ». */
export type SitePhotoName = 'hero' | 'hotel' | 'quartier';

/** Width of the version given to browsers that ignore « srcset ». */
const FALLBACK_WIDTH = 800;

/**
 * Relative to the base address of the page (« /fr/ », « /en/ »): each language has its own
 * copy of the files of « public ».
 */
function fileUrl(name: SitePhotoName, width: number): string {
  return `images/site/${name}-${width}.webp`;
}

/** null while the photo has not been made: the page then shows its placeholder. */
export function sitePhoto(
  name: SitePhotoName,
  alt: string,
  files: Partial<Record<string, SitePhotoFiles>> = SITE_PHOTO_FILES,
): PhotoView | null {
  const found = files[name];
  const widths = [...(found?.widths ?? [])].sort((a, b) => a - b);
  const fallback = widths.find((width) => width >= FALLBACK_WIDTH) ?? widths.at(-1);
  if (found === undefined || fallback === undefined) {
    return null;
  }
  return {
    alt,
    src: fileUrl(name, fallback),
    srcset: widths.map((width) => `${fileUrl(name, width)} ${width}w`).join(', '),
    width: found.width,
    height: found.height,
  };
}
