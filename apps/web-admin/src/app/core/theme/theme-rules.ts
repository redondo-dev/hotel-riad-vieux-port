/**
 * The colours of the staff tool (step T-2): dark by default, light on demand. The choice is kept
 * in the browser of each member of staff only.
 */

export type Theme = 'light' | 'dark';

/** Key of the choice in the storage of the browser. */
export const THEME_KEY = 'adm-theme';

export const DEFAULT_THEME: Theme = 'dark';

/** The theme stored, or the default one when nothing valid was stored. */
export function themeOf(stored: string | null): Theme {
  return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
