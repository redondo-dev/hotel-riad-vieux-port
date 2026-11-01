/**
 * Business errors. The rules throw these typed errors; a single HTTP middleware turns them into
 * the RFC 9457 format (architecture, section 5). Any other error is treated as unexpected: the
 * client receives a generic 500 and the details stay in the server log.
 *
 * `code` is stable and meant for the applications (UPPER_SNAKE_CASE); `title` and `detail` are
 * shown to people, in French.
 */

export interface FieldError {
  /** Path of the field, for example « rooms[0].adults ». */
  field: string;
  message: string;
}

export interface AppErrorInit {
  status: number;
  code: string;
  title: string;
  detail?: string;
  errors?: FieldError[];
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;

  constructor(init: AppErrorInit) {
    super(init.detail ?? init.title);
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.errors = init.errors;
  }
}

export class ValidationError extends AppError {
  constructor(errors: FieldError[]) {
    super({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Données invalides',
      detail: 'Certains champs sont à corriger.',
      errors,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(detail = 'Cette ressource n’existe pas.') {
    super({ status: 404, code: 'NOT_FOUND', title: 'Introuvable', detail });
  }
}

export class TooManyRequestsError extends AppError {
  constructor() {
    super({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      title: 'Trop de requêtes',
      detail: 'Trop de demandes en peu de temps. Patientez quelques minutes avant de réessayer.',
    });
  }
}

export class ForbiddenOriginError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'ORIGIN_NOT_ALLOWED',
      title: 'Origine non autorisée',
      detail: 'Ce site n’est pas autorisé à appeler l’API.',
    });
  }
}
