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

/** Online booking: the visitor already holds rooms waiting for their payment (step S-2). */
export class TooManyPendingError extends AppError {
  constructor() {
    super({
      status: 429,
      code: 'TOO_MANY_PENDING',
      title: 'Réservation déjà en attente',
      detail:
        'Une réservation attend déjà son paiement. Terminez-la, ou réessayez dans une demi-heure.',
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

export class ConflictError extends AppError {
  constructor(code: string, title: string, detail: string) {
    super({ status: 409, code, title, detail });
  }
}

export class AuthenticationRequiredError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
      title: 'Connexion requise',
      detail: 'Votre session a expiré ou vous n’êtes pas connecté. Connectez-vous pour continuer.',
    });
  }
}

/** Public route called by someone else than the public site's server (step S-1). */
export class RelayRequiredError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'RELAY_REQUIRED',
      title: 'Accès refusé',
      detail: 'Cette adresse n’est ouverte qu’au site de l’hôtel.',
    });
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'FORBIDDEN',
      title: 'Accès refusé',
      detail: 'Votre rôle ne permet pas cette action.',
    });
  }
}

export class CsrfTokenError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'CSRF_TOKEN_INVALID',
      title: 'Requête refusée',
      detail: 'Le jeton de sécurité est absent ou invalide. Rechargez la page puis réessayez.',
    });
  }
}
