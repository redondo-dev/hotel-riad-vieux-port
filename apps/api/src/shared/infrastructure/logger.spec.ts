import { describe, expect, it } from 'vitest';
import { createLogger, maskEmail } from './logger.ts';

function capture(): { lines: () => Record<string, unknown>[]; write: (line: string) => void } {
  const output: string[] = [];
  return {
    write: (line: string) => {
      output.push(line);
    },
    lines: () => output.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('maskEmail', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskEmail('jeanne.martin@example.org')).toBe('j***@example.org');
  });

  it('hides anything that is not a readable address', () => {
    expect(maskEmail('pas-une-adresse')).toBe('[masqué]');
    expect(maskEmail(42)).toBe('[masqué]');
  });
});

describe('createLogger', () => {
  it('never writes passwords, tokens, cookies or full e-mail addresses', () => {
    const stream = capture();
    const logger = createLogger({ level: 'info', pretty: false }, stream);

    logger.info(
      {
        password: 'Correct-Horse-1',
        user: {
          email: 'jeanne.martin@example.org',
          passwordHash: '$argon2id$x',
          role: 'reception',
        },
        req: { headers: { cookie: 'riad.sid=abc', authorization: 'Bearer xyz' } },
      },
      'connexion',
    );

    const [entry] = stream.lines();
    const text = JSON.stringify(entry);
    for (const secret of ['Correct-Horse-1', '$argon2id$x', 'riad.sid=abc', 'Bearer xyz']) {
      expect(text.includes(secret)).toBe(false);
    }
    expect(text.includes('jeanne.martin')).toBe(false);
    expect(text.includes('j***@example.org')).toBe(true);
    // Non-sensitive fields are kept.
    expect(text.includes('reception')).toBe(true);
  });

  it('respects the configured level', () => {
    const stream = capture();
    const logger = createLogger({ level: 'warn', pretty: false }, stream);
    logger.info('ignoré');
    logger.warn('gardé');
    expect(stream.lines().map((line) => line.msg)).toEqual(['gardé']);
  });
});
