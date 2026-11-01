import { describe, expect, it } from 'vitest';
import { AppError, ValidationError } from '../domain/errors.ts';
import { toProblem } from './problem.ts';

describe('toProblem', () => {
  it('answers a business error with its own status, code and fields', () => {
    const { problem, unexpected } = toProblem(
      new ValidationError([{ field: 'rooms[0].adults', message: 'Au moins 1 adulte.' }]),
      'trace-1',
    );
    expect(unexpected).toBe(false);
    expect(problem).toEqual({
      type: 'https://api.riad-vieux-port.example/errors/validation-failed',
      title: 'Données invalides',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'Certains champs sont à corriger.',
      errors: [{ field: 'rooms[0].adults', message: 'Au moins 1 adulte.' }],
      traceId: 'trace-1',
    });
  });

  it('leaves out the optional members a business error does not have', () => {
    const { problem } = toProblem(
      new AppError({ status: 409, code: 'AVAILABILITY_CHANGED', title: 'Plus disponible' }),
      't',
    );
    expect('detail' in problem).toBe(false);
    expect('errors' in problem).toBe(false);
  });

  it('translates the body parser errors', () => {
    const malformed = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    expect(toProblem(malformed, 't').problem.code).toBe('MALFORMED_JSON');
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    expect(toProblem(tooLarge, 't').problem.status).toBe(413);
  });

  it('hides everything about an unexpected error', () => {
    const { problem, unexpected } = toProblem(
      new Error('relation "users" does not exist at /srv/app/src/x.ts:12'),
      'trace-9',
    );
    expect(unexpected).toBe(true);
    expect(problem.status).toBe(500);
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(problem.traceId).toBe('trace-9');
    const text = JSON.stringify(problem);
    expect(text.includes('relation')).toBe(false);
    expect(text.includes('/srv/app')).toBe(false);
  });

  it('treats a thrown non-error value as unexpected', () => {
    expect(toProblem('boom', 't').unexpected).toBe(true);
    expect(toProblem(null, 't').problem.status).toBe(500);
  });
});
