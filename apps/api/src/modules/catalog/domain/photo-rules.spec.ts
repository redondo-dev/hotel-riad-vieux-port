import { describe, expect, it } from 'vitest';
import {
  formatFromSignature,
  MEDIA_FILE,
  orderProblem,
  photoKey,
  photoSources,
} from './photo-rules.ts';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('stored versions', () => {
  it('names the three WebP versions and their public addresses', () => {
    expect(photoKey(ID, 800)).toBe(`photos/${ID}-800.webp`);
    expect(photoSources(ID).map((source) => source.width)).toEqual([400, 800, 1600]);
    expect(photoSources(ID)[0]?.url).toBe(`/api/v1/public/media/${ID}-400.webp`);
  });

  it('serves only the names the API gives', () => {
    expect(MEDIA_FILE.test(`${ID}-1600.webp`)).toBe(true);
    expect(MEDIA_FILE.test(`${ID}-1200.webp`)).toBe(false);
    expect(MEDIA_FILE.test(`../${ID}-400.webp`)).toBe(false);
    expect(MEDIA_FILE.test(`${ID}-400.webp.png`)).toBe(false);
  });
});

describe('orderProblem', () => {
  it('wants every photo of the category, once each', () => {
    expect(orderProblem(['a', 'b'], ['b', 'a'])).toBeNull();
    expect(orderProblem(['a', 'b'], ['a'])).toMatch(/toutes les photos/);
    expect(orderProblem(['a', 'b'], ['a', 'a'])).toMatch(/deux fois/);
    expect(orderProblem(['a', 'b'], ['a', 'c'])).toMatch(/toutes les photos/);
  });
});

describe('formatFromSignature', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const text = (value: string) => new TextEncoder().encode(value);

  it('names JPEG, PNG and WebP from their first bytes', () => {
    expect(formatFromSignature(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(formatFromSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(formatFromSignature(text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('webp');
  });

  it('refuses SVG, HEIC and other files before any decoder reads them', () => {
    expect(formatFromSignature(text('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(formatFromSignature(text('\u0000\u0000\u0000\u0018ftypheic'))).toBeNull();
    expect(formatFromSignature(text('GIF89a'))).toBeNull();
    expect(formatFromSignature(text('RIFF\u0000\u0000\u0000\u0000WAVE'))).toBeNull();
    expect(formatFromSignature(bytes(0xff, 0xd8))).toBeNull();
  });
});
