import { describe, expect, it } from 'vitest';
import { greetingAt } from './login-greeting';

describe('greetingAt', () => {
  it('says « Bonjour » from 5 a.m. to 6 p.m., « Bonsoir » the rest of the time', () => {
    const at = (hour: number, minute: number) => new Date(2026, 10, 19, hour, minute);
    expect(greetingAt(at(4, 59))).toBe('Bonsoir');
    expect(greetingAt(at(5, 0))).toBe('Bonjour');
    expect(greetingAt(at(17, 59))).toBe('Bonjour');
    expect(greetingAt(at(18, 0))).toBe('Bonsoir');
    expect(greetingAt(at(0, 0))).toBe('Bonsoir');
  });
});
