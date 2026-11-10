import { describe, expect, it } from 'vitest';
import { countryOptions } from './countries';

describe('countryOptions', () => {
  it('names the countries in the language of the page, in alphabetical order', () => {
    const french = countryOptions('fr');
    expect(french.find((country) => country.code === 'DE')?.name).toBe('Allemagne');
    expect(countryOptions('en').find((country) => country.code === 'DE')?.name).toBe('Germany');
    const names = french.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fr')));
    expect(new Set(french.map((country) => country.code)).size).toBe(french.length);
  });
});
