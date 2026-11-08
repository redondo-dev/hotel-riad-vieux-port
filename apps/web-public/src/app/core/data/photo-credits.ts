/**
 * Who took each photo of the site (fixed photos and photos of the rooms), all from Unsplash
 * (Unsplash License: free use, credit not required but given). The list will be displayed by
 * the legal notice page, when it exists; until then, the footer says « Photos : Unsplash ».
 */

export interface PhotoCredit {
  /** The photo, as named when chosen: « hero.jpg », « double-standard-1.jpg »… */
  photo: string;
  photographer: string;
  /** Page of the photo on Unsplash. */
  url: string;
}

export const PHOTO_CREDITS: PhotoCredit[] = [];
