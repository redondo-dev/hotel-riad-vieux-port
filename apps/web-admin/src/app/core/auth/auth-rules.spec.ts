import { describe, expect, it } from 'vitest';
import { passwordAcceptable, passwordChecks } from './password-rules';
import { safeReturnUrl } from './return-url';
import { isRole, landingFor, menuFor } from './roles';

describe('menuFor', () => {
  it('shows the account management to the management only', () => {
    const paths = (role: Parameters<typeof menuFor>[0]): string[] =>
      menuFor(role).map((item) => item.path);
    expect(paths('direction')).toEqual(['/accueil', '/menage', '/catalogue', '/utilisateurs']);
    expect(paths('reception')).toEqual(['/accueil', '/menage', '/catalogue']);
    expect(paths('housekeeping')).toEqual(['/accueil', '/menage']);
    expect(paths('technician')).toEqual(['/accueil']);
  });
});

describe('landingFor', () => {
  it('opens the housekeeping board for housekeeping, the home page for the others', () => {
    expect(landingFor('housekeeping')).toBe('/menage');
    expect(landingFor('technician')).toBe('/accueil');
    expect(landingFor('direction')).toBe('/accueil');
  });
});

describe('isRole', () => {
  it('accepts the four roles only', () => {
    expect(isRole('reception')).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('safeReturnUrl', () => {
  it('keeps an address of the staff tool', () => {
    expect(safeReturnUrl('/utilisateurs')).toBe('/utilisateurs');
    expect(safeReturnUrl('/utilisateurs?actifs=1')).toBe('/utilisateurs?actifs=1');
  });

  it('refuses any address that could lead to another site', () => {
    for (const value of [
      'https://site-malveillant.example',
      '//site-malveillant.example',
      '/\\site-malveillant.example',
      'javascript:alert(1)',
      'utilisateurs',
    ]) {
      expect(safeReturnUrl(value)).toBe(undefined);
    }
  });

  it('never sends back to the login or password pages', () => {
    expect(safeReturnUrl('/connexion')).toBe(undefined);
    expect(safeReturnUrl('/mot-de-passe-oublie')).toBe(undefined);
    expect(safeReturnUrl(null)).toBe(undefined);
  });
});

describe('passwordChecks', () => {
  it('requires 12 characters and two identical entries', () => {
    expect(passwordChecks('court', 'court').map((check) => check.met)).toEqual([false, true]);
    expect(passwordChecks('Vieux-Port-2026', 'Vieux-Port-2025').map((check) => check.met)).toEqual([
      true,
      false,
    ]);
    expect(passwordAcceptable('Vieux-Port-2026', 'Vieux-Port-2026')).toBe(true);
  });

  it('shows the maximum length only once exceeded', () => {
    const long = 'x'.repeat(129);
    expect(passwordChecks(long, long).map((check) => check.id)).toEqual(['length', 'max', 'match']);
    expect(passwordAcceptable(long, long)).toBe(false);
  });

  it('does not count two empty entries as identical', () => {
    expect(passwordChecks('', '').find((check) => check.id === 'match')?.met).toBe(false);
  });
});
