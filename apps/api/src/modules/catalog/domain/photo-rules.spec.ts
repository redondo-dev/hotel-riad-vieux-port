import { describe, expect, it } from 'vitest';
import { MEDIA_FILE, orderProblem, photoKey, photoSources } from './photo-rules.ts';

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
