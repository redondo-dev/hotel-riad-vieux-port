import { describe, expect, it } from 'vitest';
import {
  countText,
  fileProblem,
  mainFirstOrder,
  MAX_PHOTO_BYTES,
  movedOrder,
  smallestUrl,
  srcsetOf,
} from './photo-model';

describe('photo files', () => {
  it('accepts JPEG, PNG and WebP up to 10 MB', () => {
    expect(fileProblem({ type: 'image/jpeg', size: 2_000_000 })).toBeNull();
    expect(fileProblem({ type: 'image/png', size: MAX_PHOTO_BYTES })).toBeNull();
    expect(fileProblem({ type: 'image/webp', size: 1 })).toBeNull();
  });

  it('refuses other formats and heavier files', () => {
    expect(fileProblem({ type: 'image/gif', size: 1000 })).toContain('JPEG, PNG ou WebP');
    expect(fileProblem({ type: 'application/pdf', size: 1000 })).toContain('JPEG');
    expect(fileProblem({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 })).toContain('10 Mo');
  });
});

describe('photo order', () => {
  const ids = ['a', 'b', 'c'];

  it('moves a photo one place to the left or the right', () => {
    expect(movedOrder(ids, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(movedOrder(ids, 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('keeps the order when the photo is already at the end', () => {
    expect(movedOrder(ids, 0, -1)).toEqual(ids);
    expect(movedOrder(ids, 2, 1)).toEqual(ids);
    expect(movedOrder(ids, 5, 1)).toEqual(ids);
  });

  it('puts the chosen photo first, the others in their order', () => {
    expect(mainFirstOrder(ids, 2)).toEqual(['c', 'a', 'b']);
    expect(mainFirstOrder(ids, 0)).toEqual(ids);
    expect(mainFirstOrder(ids, 9)).toEqual(ids);
  });
});

describe('photo display', () => {
  const sources = [
    { width: 400, url: '/m/x-400.webp' },
    { width: 800, url: '/m/x-800.webp' },
  ];

  it('lists every size for the browser', () => {
    expect(srcsetOf(sources)).toBe('/m/x-400.webp 400w, /m/x-800.webp 800w');
    expect(smallestUrl(sources)).toBe('/m/x-400.webp');
    expect(smallestUrl([])).toBe('');
  });

  it('counts the photos', () => {
    expect(countText(0)).toBe('Aucune photo (12 au plus).');
    expect(countText(1)).toBe('1 photo sur 12.');
    expect(countText(3)).toBe('3 photos sur 12.');
  });
});
