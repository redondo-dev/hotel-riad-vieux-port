import { describe, expect, it } from 'vitest';
import { LOGIN_PHOTO_IDS, loginPhotoUrl, pickLoginPhoto } from './login-photos';

describe('login photo', () => {
  it('always draws a photo of the list, from the first to the last', () => {
    expect(pickLoginPhoto(() => 0)).toBe(LOGIN_PHOTO_IDS[0]);
    expect(pickLoginPhoto(() => 0.999999)).toBe(LOGIN_PHOTO_IDS.at(-1));
    expect(pickLoginPhoto(() => 1)).toBe(LOGIN_PHOTO_IDS.at(-1));
    for (let draw = 0; draw < 50; draw += 1) {
      expect(LOGIN_PHOTO_IDS).toContain(pickLoginPhoto());
    }
  });

  it('asks Picsum for that photo, in portrait', () => {
    expect(loginPhotoUrl(1015)).toBe('https://picsum.photos/id/1015/1000/1400');
  });
});
