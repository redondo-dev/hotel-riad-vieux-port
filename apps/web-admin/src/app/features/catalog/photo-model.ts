import type { LocalizedText } from './catalog-model';

/**
 * The photos of a category as the staff tool shows them (module « Photos »). The API checks
 * everything again: these rules only spare a useless upload and compute the new order.
 */

export interface PhotoSource {
  width: number;
  url: string;
}

export interface Photo {
  id: string;
  alt: LocalizedText;
  /** 0 for the main photo. */
  position: number;
  width: number | null;
  height: number | null;
  /** Smallest first. */
  sources: PhotoSource[];
}

/** Same limits as the API. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_CATEGORY = 12;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** What the file input accepts (the file picker shows only these). */
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

/** Why this file will be refused, or null when it can be sent. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES.some((type) => type === file.type)) {
    return 'Photo attendue au format JPEG, PNG ou WebP.';
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `Une photo pèse ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au plus.`;
  }
  return null;
}

/** The order after moving the photo at `index` one place to the left (-1) or the right (1). */
export function movedOrder(ids: readonly string[], index: number, offset: -1 | 1): string[] {
  const target = index + offset;
  const order = [...ids];
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) {
    return order;
  }
  [order[index], order[target]] = [order[target] ?? '', order[index] ?? ''];
  return order;
}

/** The order once the photo at `index` becomes the main one; the others keep their order. */
export function mainFirstOrder(ids: readonly string[], index: number): string[] {
  const chosen = ids[index];
  if (chosen === undefined) {
    return [...ids];
  }
  return [chosen, ...ids.filter((_, position) => position !== index)];
}

/** « url 400w, url 800w, url 1600w »: the browser picks the size it needs. */
export function srcsetOf(sources: readonly PhotoSource[]): string {
  return sources.map((source) => `${source.url} ${source.width}w`).join(', ');
}

/** The smallest version, for browsers that ignore « srcset ». */
export function smallestUrl(sources: readonly PhotoSource[]): string {
  return sources[0]?.url ?? '';
}

export function countText(count: number): string {
  if (count === 0) {
    return `Aucune photo (${MAX_PHOTOS_PER_CATEGORY} au plus).`;
  }
  return `${count} photo${count > 1 ? 's' : ''} sur ${MAX_PHOTOS_PER_CATEGORY}.`;
}
