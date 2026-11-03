import { describe, expect, it } from 'vitest';
import {
  changeText,
  doneText,
  monthText,
  percentText,
  pointsText,
  trendOf,
} from './dashboard-model';

/** Intl writes non-breaking spaces: compared here with plain spaces. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('changes since the month before', () => {
  it('gives a rate in points, an amount in %', () => {
    expect(plain(percentText(11.8))).toBe('11,8 %');
    expect(pointsText(3.3, 0.3)).toBe('+3,0 pts');
    expect(pointsText(5, 5.5)).toBe('-0,5 pt');
    expect(pointsText(4, 4)).toBe('stable');
    expect(plain(changeText(112, 100))).toBe('+12 %');
    expect(plain(changeText(90, 100))).toBe('-10 %');
  });

  it('never divides by zero', () => {
    expect(changeText(500, 0)).toBe('nouveau');
    expect(changeText(0, 0)).toBe('stable');
  });

  it('tells whether a figure goes up or down', () => {
    expect(trendOf(3.3, 0.3)).toBe('up');
    expect(trendOf(1, 2)).toBe('down');
    expect(trendOf(2, 2)).toBe('flat');
  });
});

describe('texts', () => {
  it('names the month and counts what is done', () => {
    expect(monthText('2026-11')).toBe('novembre 2026');
    expect(doneText({ total: 4, done: 3 }, true)).toBe('4, dont 3 faites');
    expect(doneText({ total: 1, done: 1 }, false)).toBe('1, dont 1 fait');
  });
});
