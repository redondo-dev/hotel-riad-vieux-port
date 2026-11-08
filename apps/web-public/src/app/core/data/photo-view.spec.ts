import { describe, expect, it } from 'vitest';
import { photoViewOf } from './photo-view';

const ID = '0b9f6a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b';

const PHOTO = {
  alt: { fr: 'Lit double face au port', en: 'Double bed facing the harbour' },
  width: 1600,
  height: 1067,
  files: [1600, 400, 800].map((width) => ({ width, file: `${ID}-${width}.webp` })),
};

describe('photoViewOf', () => {
  it('gives every size to the browser, and the 800 pixels version by default', () => {
    expect(photoViewOf(PHOTO, 'en')).toEqual({
      alt: 'Double bed facing the harbour',
      src: `/media/${ID}-800.webp`,
      srcset: `/media/${ID}-400.webp 400w, /media/${ID}-800.webp 800w, /media/${ID}-1600.webp 1600w`,
      width: 1600,
      height: 1067,
    });
  });

  it('falls back to the largest version, and skips a photo without files', () => {
    const small = { ...PHOTO, files: [{ width: 400, file: `${ID}-400.webp` }] };
    expect(photoViewOf(small, 'fr')?.src).toBe(`/media/${ID}-400.webp`);
    expect(photoViewOf({ ...PHOTO, files: [] }, 'fr')).toBeNull();
  });
});
