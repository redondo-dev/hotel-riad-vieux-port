import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { type FieldError, ValidationError } from '../domain/errors.ts';

// Default validation messages in French (the API speaks to French-speaking staff and guests).
z.config(z.locales.fr());

type Part = 'body' | 'query' | 'params';

/** Zod schemas of the parts of a request to check; a missing part is not read. */
export type RequestSchemas = Partial<Record<Part, z.ZodType>>;

type Output<S> = S extends z.ZodType ? z.output<S> : undefined;

/** The request parts, checked and converted (dates, numbers…). */
export interface ValidatedInput<S extends RequestSchemas> {
  body: Output<S['body']>;
  query: Output<S['query']>;
  params: Output<S['params']>;
}

/** « rooms[0].adults » from ['rooms', 0, 'adults']; the part name when the whole part is wrong. */
export function fieldPath(part: Part, path: readonly PropertyKey[]): string {
  let text = '';
  for (const key of path) {
    if (typeof key === 'number') {
      text += `[${key}]`;
    } else {
      text += text === '' ? String(key) : `.${String(key)}`;
    }
  }
  return text === '' ? part : text;
}

/**
 * Checks the request against its schemas BEFORE any business code runs, then calls the handler
 * with typed, converted values. Every problem of every part is reported at once, in a single
 * 400 response listing the fields (`errors`), so that a form can show them all together.
 *
 * Unknown fields are handled by the schemas themselves (`z.strictObject` refuses them).
 */
export function validated<S extends RequestSchemas>(
  schemas: S,
  handler: (input: ValidatedInput<S>, req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return async (req, res) => {
    const errors: FieldError[] = [];
    const values: Partial<Record<Part, unknown>> = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (schema === undefined) {
        continue;
      }
      const result = schema.safeParse(req[part]);
      if (result.success) {
        values[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          errors.push({ field: fieldPath(part, issue.path), message: issue.message });
        }
      }
    }
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
    await handler(values as ValidatedInput<S>, req, res);
  };
}
