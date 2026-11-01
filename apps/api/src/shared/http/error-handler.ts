import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { NotFoundError } from '../domain/errors.ts';
import { PROBLEM_CONTENT_TYPE, toProblem } from './problem.ts';
import { traceIdOf } from './request-context.ts';

/** Placed after every route: any unknown address ends in a 404 in the standard format. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Aucune ressource ne correspond à cette adresse.'));
};

/**
 * The single error handler of the API (architecture, section 7). Placed last.
 *
 * Expected errors (validation, not found, too many requests…) are answered as they are.
 * Unexpected ones are logged with their stack and the trace identifier, and the client gets a
 * generic 500 that reveals nothing about the server.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      // The response has already started: let Express close the connection.
      next(error);
      return;
    }
    const traceId = traceIdOf(req);
    const { problem, unexpected } = toProblem(error, traceId);
    if (unexpected) {
      logger.error({ err: error, traceId }, 'erreur inattendue');
    }
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  };
}
