import { describe, expect, it } from 'vitest';
import {
  canEditCatalog,
  canManageClosures,
  eurosInputValue,
  formatEuros,
  formatNights,
  formatPercent,
  nightCount,
  parseEuros,
  parsePercent,
  parseWhole,
  percentInputValue,
} from './catalog-model';

/** Intl writes narrow non-breaking spaces: compared here with plain spaces. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('catalogue rights', () => {
  it('lets the management change the catalogue, nobody else', () => {
    expect(canEditCatalog('direction')).toBe(true);
    expect(canEditCatalog('reception')).toBe(false);
    expect(canEditCatalog(undefined)).toBe(false);
  });

  it('lets the management and the reception manage the sales closures', () => {
    expect(canManageClosures('direction')).toBe(true);
    expect(canManageClosures('reception')).toBe(true);
    expect(canManageClosures('housekeeping')).toBe(false);
  });
});

describe('amounts', () => {
  it('formats cents as euros', () => {
    expect(plain(formatEuros(9550))).toBe('95,50 €');
    expect(plain(formatEuros(120_000))).toBe('1 200,00 €');
    expect(eurosInputValue(9550)).toBe('95,50');
  });

  it('reads what the staff types', () => {
    expect(parseEuros('95')).toBe(9500);
    expect(parseEuros('95,5')).toBe(9550);
    expect(parseEuros(' 95,50 € ')).toBe(9550);
    expect(parseEuros('1 200,00')).toBe(120_000);
    expect(parseEuros('19.99')).toBe(1999);
  });

  it('refuses what is not an amount', () => {
    for (const text of ['', 'abc', '-5', '9,999', '1,2,3']) {
      expect(parseEuros(text)).toBe(null);
    }
  });
});

describe('percentages', () => {
  it('formats with a sign', () => {
    expect(formatPercent(20)).toBe('+20 %');
    expect(formatPercent(-15)).toBe('-15 %');
    expect(formatPercent(35.5)).toBe('+35,5 %');
    expect(formatPercent(0)).toBe('0 %');
    expect(percentInputValue(35.5)).toBe('35,5');
  });

  it('reads what the staff types', () => {
    expect(parsePercent('20')).toBe(20);
    expect(parsePercent('-15')).toBe(-15);
    expect(parsePercent('+35,5 %')).toBe(35.5);
    expect(parsePercent('12,345')).toBe(null);
    expect(parsePercent('dix')).toBe(null);
  });

  it('reads whole numbers', () => {
    expect(parseWhole(' 3 ')).toBe(3);
    expect(parseWhole('-1')).toBe(-1);
    expect(parseWhole('2,5')).toBe(null);
  });
});

describe('formatNights', () => {
  it('says the nights as the staff does, last night included', () => {
    expect(formatNights('2031-07-10', '2031-07-10')).toBe('nuit du 10 juillet 2031');
    expect(formatNights('2031-07-10', '2031-07-12')).toBe('nuits du 10 au 12 juillet 2031');
    expect(formatNights('2031-06-28', '2031-07-02')).toBe('nuits du 28 juin au 2 juillet 2031');
    expect(formatNights('2031-12-30', '2032-01-02')).toBe(
      'nuits du 30 décembre 2031 au 2 janvier 2032',
    );
  });

  it('counts the nights', () => {
    expect(nightCount('2031-07-10', '2031-07-12')).toBe(3);
    expect(nightCount('2031-03-29', '2031-03-31')).toBe(3);
  });
});
