import { HttpErrorResponse } from '@angular/common/http';

/**
 * Errors of the API arrive in the RFC 9457 format (`application/problem+json`). This turns any
 * failure (API error, network down, unexpected answer) into one shape the screens can display.
 */
export interface Problem {
  /** HTTP status; 0 when the server could not be reached. */
  status: number;
  code: string;
  title: string;
  detail: string;
  errors: { field: string; message: string }[];
  /** To quote when reporting the problem; links it to the server log. */
  traceId?: string;
}

const UNEXPECTED: Omit<Problem, 'status'> = {
  code: 'UNEXPECTED',
  title: 'Erreur inattendue',
  detail: 'Une erreur inattendue est survenue. Réessayez dans quelques instants.',
  errors: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toProblem(error: unknown): Problem {
  if (!(error instanceof HttpErrorResponse)) {
    return { status: -1, ...UNEXPECTED };
  }
  if (error.status === 0) {
    return {
      status: 0,
      code: 'NETWORK',
      title: 'Serveur injoignable',
      detail: 'Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.',
      errors: [],
    };
  }
  const body: unknown = error.error;
  if (!isRecord(body) || typeof body['code'] !== 'string') {
    return { status: error.status, ...UNEXPECTED };
  }
  const errors = Array.isArray(body['errors'])
    ? body['errors'].filter(
        (item): item is { field: string; message: string } =>
          isRecord(item) &&
          typeof item['field'] === 'string' &&
          typeof item['message'] === 'string',
      )
    : [];
  return {
    status: error.status,
    code: body['code'],
    title: typeof body['title'] === 'string' ? body['title'] : UNEXPECTED.title,
    detail: typeof body['detail'] === 'string' ? body['detail'] : UNEXPECTED.detail,
    errors,
    ...(typeof body['traceId'] === 'string' ? { traceId: body['traceId'] } : {}),
  };
}

/** Message of the API for one field, if any. */
export function fieldMessage(problem: Problem | null, field: string): string | undefined {
  return problem?.errors.find((error) => error.field === field)?.message;
}
