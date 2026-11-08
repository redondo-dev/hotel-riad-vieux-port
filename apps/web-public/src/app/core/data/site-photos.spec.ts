import { describe, expect, it } from 'vitest';
import { sitePhoto } from './site-photos';

const FILES = { hero: { widths: [1920, 800, 1280], width: 1920, height: 1280 } };

describe('sitePhoto', () => {
  it('gives every size, relative to the language of the page', () => {
    expect(sitePhoto('hero', 'Le Vieux-Port', FILES)).toEqual({
      alt: 'Le Vieux-Port',
      src: 'images/site/hero-800.webp',
      srcset:
        'images/site/hero-800.webp 800w, images/site/hero-1280.webp 1280w, ' +
        'images/site/hero-1920.webp 1920w',
      width: 1920,
      height: 1280,
    });
  });

  it('gives nothing while the photo has not been made', () => {
    const empty = { hotel: { widths: [], width: 1, height: 1 } };
    expect(sitePhoto('hotel', 'Le patio', FILES)).toBeNull();
    expect(sitePhoto('hotel', 'Le patio', empty)).toBeNull();
  });
});
