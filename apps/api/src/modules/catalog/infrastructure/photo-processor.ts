import sharp from 'sharp';
import { ValidationError } from '../../../shared/domain/errors.ts';
import { formatFromSignature, PHOTO_WIDTHS, type PhotoWidth } from '../domain/photo-rules.ts';

/**
 * Reads a photo sent by the staff and makes its stored versions, with sharp:
 *  - the format is read from the first bytes of the file, before sharp decodes anything: only
 *    JPEG, PNG and WebP reach the image libraries (a text renamed « .jpg » is refused); sharp
 *    must then read the same format;
 *  - the photo is turned the way the camera says (EXIF orientation), then every metadata is
 *    dropped (GPS position, camera, date): sharp writes none unless asked;
 *  - three WebP versions, 400, 800 and 1600 pixels wide, never enlarged.
 */

export interface ProcessedPhoto {
  /** Size of the largest version, as displayed. */
  width: number;
  height: number;
  versions: { width: PhotoWidth; data: Buffer }[];
}

/** A picture of more than 50 million pixels is refused before it is decoded (memory). */
const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;

function notAPhoto(): ValidationError {
  return new ValidationError([
    { field: 'file', message: 'Photo attendue au format JPEG, PNG ou WebP.' },
  ]);
}

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const options = { failOn: 'error' as const, limitInputPixels: MAX_INPUT_PIXELS };
  const expected = formatFromSignature(input);
  if (expected === null) {
    throw notAPhoto();
  }
  let format: string | undefined;
  try {
    format = (await sharp(input, options).metadata()).format;
  } catch {
    throw notAPhoto();
  }
  if (format !== expected) {
    throw notAPhoto();
  }
  const versions: ProcessedPhoto['versions'] = [];
  let width = 0;
  let height = 0;
  for (const target of PHOTO_WIDTHS) {
    const { data, info } = await sharp(input, options)
      .rotate()
      .resize({ width: target, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    versions.push({ width: target, data });
    width = info.width;
    height = info.height;
  }
  return { width, height, versions };
}
