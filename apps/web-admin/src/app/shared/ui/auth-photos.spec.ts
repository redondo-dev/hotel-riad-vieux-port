import { describe, expect, it } from 'vitest';
import { AUTH_PHOTO_IDS, authPhotoUrl, pickAuthPhoto } from './auth-photos';

describe('photo of the pages without session', () => {
  it('always draws a photo of the list, from the first to the last', () => {
    expect(pickAuthPhoto(() => 0)).toBe(AUTH_PHOTO_IDS[0]);
    expect(pickAuthPhoto(() => 0.999999)).toBe(AUTH_PHOTO_IDS.at(-1));
    expect(pickAuthPhoto(() => 1)).toBe(AUTH_PHOTO_IDS.at(-1));
    for (let draw = 0; draw < 50; draw += 1) {
      expect(AUTH_PHOTO_IDS).toContain(pickAuthPhoto());
    }
  });

  it('asks Picsum for that photo, the size of a large screen', () => {
    expect(authPhotoUrl(1015)).toBe('https://picsum.photos/id/1015/1920/1080');
  });
});
