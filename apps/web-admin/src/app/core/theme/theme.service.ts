import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { otherTheme, type Theme, THEME_KEY, themeOf } from './theme-rules';

function readTheme(): Theme {
  try {
    return themeOf(localStorage.getItem(THEME_KEY));
  } catch {
    // Storage blocked by the browser: the default theme, without error.
    return themeOf(null);
  }
}

/**
 * The theme of the staff tool (step T-2), set as `data-theme` on the root element: the colours
 * of styles.css follow it. index.html sets the dark theme first, so that nothing flashes white.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<Theme>(readTheme());

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    const next = otherTheme(this.theme());
    this.theme.set(next);
    this.apply(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked: the choice holds until the page is reloaded.
    }
  }

  private apply(theme: Theme): void {
    this.document.documentElement.dataset['theme'] = theme;
  }
}
