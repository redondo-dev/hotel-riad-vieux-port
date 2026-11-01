import { AppError, type FieldError } from '../domain/errors.ts';

/** Media type of every error response (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Base of the `type` URIs: one documented page per error code. */
const TYPE_BASE = 'https://api.riad-vieux-port.example/errors/';

/** Error body, as described by the `Problem` schema of openapi.yaml. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: FieldError[];
  traceId: string;
}

export interface ProblemOutcome {
  problem: Problem;
  /** True for a programming or infrastructure error: it must be logged with its stack. */
  unexpected: boolean;
}

/** Shape of the errors raised by Express's body parser (malformed JSON, body too large…). */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

function fromAppError(error: AppError, traceId: string): Problem {
  return {
    type: TYPE_BASE + error.code.toLowerCase().replaceAll('_', '-'),
    title: error.title,
    status: error.status,
    code: error.code,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
    traceId,
  };
}

function bodyParserAppError(error: BodyParserError): AppError | undefined {
  switch (error.type) {
    case 'entity.parse.failed':
      return new AppError({
        status: 400,
        code: 'MALFORMED_JSON',
        title: 'Requête illisible',
        detail: 'Le corps de la requête n’est pas un JSON valide.',
      });
    case 'entity.too.large':
      return new AppError({
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        title: 'Requête trop volumineuse',
        detail: 'Le corps de la requête dépasse la taille autorisée.',
      });
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError({
        status: 415,
        code: 'UNSUPPORTED_ENCODING',
        title: 'Encodage non pris en charge',
        detail: 'Envoyez le corps de la requête en JSON encodé en UTF-8.',
      });
    default:
      return error.status >= 400 && error.status < 500
        ? new AppError({ status: error.status, code: 'BAD_REQUEST', title: 'Requête invalide' })
        : undefined;
  }
}

const INTERNAL_ERROR = new AppError({
  status: 500,
  code: 'INTERNAL_ERROR',
  title: 'Erreur interne',
  detail: 'Une erreur inattendue est survenue. Réessayez dans quelques instants.',
});

/**
 * Turns any thrown value into the error body sent to the client. Nothing from an unexpected
 * error (message, stack, SQL…) ever reaches the body: only the generic 500 and the traceId.
 */
export function toProblem(error: unknown, traceId: string): ProblemOutcome {
  if (error instanceof AppError) {
    return { problem: fromAppError(error, traceId), unexpected: false };
  }
  if (isBodyParserError(error)) {
    const known = bodyParserAppError(error);
    if (known !== undefined) {
      return { problem: fromAppError(known, traceId), unexpected: false };
    }
  }
  return { problem: fromAppError(INTERNAL_ERROR, traceId), unexpected: true };
}
