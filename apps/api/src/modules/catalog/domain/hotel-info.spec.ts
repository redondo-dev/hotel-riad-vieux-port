import { describe, expect, it } from 'vitest';
import { displayPhone, hoursAndMinutes, minutesAfterMidnight } from './hotel-info.ts';

describe('displayPhone', () => {
  it('writes a French number the French way', () => {
    expect(displayPhone('+33465710000')).toBe('04 65 71 00 00');
    expect(displayPhone('+33612345678')).toBe('06 12 34 56 78');
  });

  it('keeps any other number as stored', () => {
    expect(displayPhone('+212522000000')).toBe('+212522000000');
    expect(displayPhone('+3346571')).toBe('+3346571');
  });
});

describe('hoursAndMinutes and minutesAfterMidnight', () => {
  it('read a PostgreSQL time', () => {
    expect(hoursAndMinutes('15:00:00')).toBe('15:00');
    expect(minutesAfterMidnight('23:00:00')).toBe(1380);
    expect(minutesAfterMidnight('00:30:00')).toBe(30);
  });
});
