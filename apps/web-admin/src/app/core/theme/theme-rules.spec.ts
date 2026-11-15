import { describe, expect, it } from 'vitest';
import { otherTheme, themeOf } from './theme-rules';

describe('theme', () => {
  it('keeps the theme chosen, dark when nothing valid was stored', () => {
    expect(themeOf('light')).toBe('light');
    expect(themeOf('dark')).toBe('dark');
    expect(themeOf(null)).toBe('dark');
    expect(themeOf('sepia')).toBe('dark');
  });

  it('switches from one theme to the other', () => {
    expect(otherTheme('dark')).toBe('light');
    expect(otherTheme('light')).toBe('dark');
  });
});
