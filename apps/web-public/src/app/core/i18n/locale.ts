import { inject, LOCALE_ID } from '@angular/core';
import type { Locale } from '@riad/shared';

/** Current language of the build (`fr` or `en`). Must be called in an injection context. */
export function injectLocale(): Locale {
  return inject(LOCALE_ID).toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/** Regional formats used for dates and prices (British English: 24-hour clock, day/month). */
export const INTL_LOCALE: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
};

export interface LanguageSwitch {
  code: Locale;
  /** Name of the language written in that language. */
  label: string;
  href: string;
}

/**
 * The other language of the site. Each language is a separate build, so switching is a
 * full page load. For now it leads to the home page of the other language.
 */
export const OTHER_LANGUAGE: Record<Locale, LanguageSwitch> = {
  fr: { code: 'en', label: 'English', href: '/en/' },
  en: { code: 'fr', label: 'Français', href: '/fr/' },
};
