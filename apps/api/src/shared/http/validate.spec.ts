import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../domain/errors.ts';
import { fieldPath, validated } from './validate.ts';

const schemas = {
  params: z.strictObject({ reference: z.string().regex(/^[A-Z0-9]{8}$/) }),
  query: z.strictObject({ nights: z.coerce.number().int().min(1).max(30) }),
  body: z.strictObject({
    rooms: z.array(z.strictObject({ adults: z.number().int().min(1) })).min(1),
  }),
};

async function run(req: Partial<Request>): Promise<{ input?: unknown; error?: unknown }> {
  let input: unknown;
  const handler = validated(schemas, (values) => {
    input = values;
  });
  try {
    await handler(req as Request, {} as Response, (() => undefined) as NextFunction);
  } catch (error) {
    return { error };
  }
  return { input };
}

describe('fieldPath', () => {
  it('writes array indexes between brackets', () => {
    expect(fieldPath('body', ['rooms', 0, 'adults'])).toBe('rooms[0].adults');
  });

  it('names the part when the whole part is wrong', () => {
    expect(fieldPath('body', [])).toBe('body');
  });
});

describe('validated', () => {
  it('hands typed and converted values to the handler', async () => {
    const { input, error } = await run({
      params: { reference: 'AB12CD34' },
      query: { nights: '3' },
      body: { rooms: [{ adults: 2 }] },
    });
    expect(error).toBe(undefined);
    expect(input).toEqual({
      params: { reference: 'AB12CD34' },
      query: { nights: 3 },
      body: { rooms: [{ adults: 2 }] },
    });
  });

  it('reports every wrong field of every part at once, without calling the handler', async () => {
    const { input, error } = await run({
      params: { reference: 'x' },
      query: { nights: '45' },
      body: { rooms: [{ adults: 0 }], coupon: 'FREE' },
    });
    expect(input).toBe(undefined);
    expect(error instanceof ValidationError).toBe(true);
    const fields = (error as ValidationError).errors?.map((item) => item.field);
    expect(fields).toEqual(['reference', 'nights', 'rooms[0].adults', 'body']);
  });

  it('refuses a missing body', async () => {
    const { error } = await run({
      params: { reference: 'AB12CD34' },
      query: { nights: '1' },
    });
    expect((error as ValidationError).errors?.map((item) => item.field)).toEqual(['body']);
  });
});
