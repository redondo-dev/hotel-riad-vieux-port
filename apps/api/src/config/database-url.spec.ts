import { describe, expect, it } from 'vitest';
import { describeDatabase } from './database-url.ts';

describe('describeDatabase', () => {
  it('names the database and the server without the password', () => {
    const description = describeDatabase('postgres://riad:s3cret@db.example.fr:5432/riad_dev');
    expect(description).toBe('riad_dev sur db.example.fr:5432');
    expect(description.includes('s3cret')).toBe(false);
  });

  it('omits a missing port', () => {
    expect(describeDatabase('postgresql://riad@localhost/riad_test')).toBe(
      'riad_test sur localhost',
    );
  });

  it('never throws on an unreadable value', () => {
    expect(describeDatabase('not a url')).toBe('(adresse de base de données illisible)');
  });
});
