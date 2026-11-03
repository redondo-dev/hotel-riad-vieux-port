import express, { type Express, Router } from 'express';
import type { Logger } from 'pino';
import type { Sequelize } from 'sequelize';
import { CatalogAdmin } from './modules/catalog/application/catalog-admin.ts';
import { PublicCatalog } from './modules/catalog/application/public-catalog.ts';
import { hotelToday } from './modules/catalog/domain/pricing.ts';
import { catalogAdminRouter } from './modules/catalog/http/catalog-admin-routes.ts';
import { publicCatalogRouter } from './modules/catalog/http/public-catalog-routes.ts';
import { CatalogRepository } from './modules/catalog/infrastructure/catalog-repository.ts';
import { HousekeepingService } from './modules/housekeeping/application/housekeeping-service.ts';
import { housekeepingRouter } from './modules/housekeeping/http/housekeeping-routes.ts';
import { IncidentService } from './modules/incidents/application/incident-service.ts';
import { incidentRouter } from './modules/incidents/http/incident-routes.ts';
import { IdentityService } from './modules/identity/application/identity-service.ts';
import { requireStaff } from './modules/identity/http/guards.ts';
import { identityRouter } from './modules/identity/http/identity-routes.ts';
import { UserRepository } from './modules/identity/infrastructure/user-repository.ts';
import { AvailabilityService } from './modules/reservations/application/availability-service.ts';
import { PlanningService } from './modules/reservations/application/planning-service.ts';
import { ReservationChanges } from './modules/reservations/application/reservation-changes.ts';
import { ReservationService } from './modules/reservations/application/reservation-service.ts';
import { availabilityRouter } from './modules/reservations/http/availability-routes.ts';
import { planningRouter } from './modules/reservations/http/planning-routes.ts';
import { reservationChangeRouter } from './modules/reservations/http/reservation-change-routes.ts';
import { reservationRouter } from './modules/reservations/http/reservation-routes.ts';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.ts';
import { type DatabaseCheck, healthRouter } from './shared/http/health.ts';
import { GLOBAL_RATE_LIMIT, type RateLimitRule, rateLimiter } from './shared/http/rate-limit.ts';
import { requestContext } from './shared/http/request-context.ts';
import { corsPolicy, jsonBody, securityHeaders } from './shared/http/security.ts';
import { type SessionStore, staffSessions } from './shared/http/session.ts';
import type { Mailer } from './shared/infrastructure/mailer.ts';

/** Prefix of every route of the API, version included. */
export const API_PREFIX = '/api/v1';

export interface AppDependencies {
  logger: Logger;
  /** Origins allowed by CORS (API_ALLOWED_ORIGINS). */
  allowedOrigins: readonly string[];
  /** Number of reverse proxies in front of the API (TRUST_PROXY). */
  trustProxy: number;
  checkDatabase: DatabaseCheck;
  /** Overall request limit; the default is the 300 requests per minute decided for the API. */
  globalRateLimit?: RateLimitRule;
  /** Adds the routes of the business modules under API_PREFIX. */
  mountRoutes?: (api: Router) => void;
  /** Staff part of the API (/admin); left out by the tests of the common HTTP layer. */
  admin?: AdminDependencies;
  /** Public part of the API (/public); left out by the tests of the common HTTP layer. */
  public?: PublicDependencies;
}

export interface PublicDependencies {
  sequelize: Sequelize;
  /** Current day at the hotel, « YYYY-MM-DD »; the tests fix it. Default: the real clock. */
  today?: () => string;
}

export interface AdminDependencies {
  sequelize: Sequelize;
  sessionStore: SessionStore;
  sessionSecret: string;
  /** True in production: session cookie sent over HTTPS only. */
  secureCookies: boolean;
  mailer: Mailer;
  /** Address of the staff tool, for the links sent by e-mail. */
  adminAppUrl: string;
  /** Current day at the hotel, « YYYY-MM-DD »; the tests fix it. Default: the real clock. */
  today?: () => string;
  /** Current instant (cancellation deadlines); the tests fix it. Default: the real clock. */
  now?: () => Date;
}

/**
 * Staff part of the API: sessions exist only here, never on the public routes. Later modules
 * add their staff routes to this router.
 */
function adminRouter(deps: AdminDependencies, logger: Logger): Router {
  const users = new UserRepository(deps.sequelize);
  const identity = new IdentityService({
    sequelize: deps.sequelize,
    users,
    mailer: deps.mailer,
    adminAppUrl: deps.adminAppUrl,
    logger,
  });
  const router = Router();
  router.use(
    staffSessions({
      store: deps.sessionStore,
      secret: deps.sessionSecret,
      secureCookies: deps.secureCookies,
    }),
  );
  const findActiveStaff = (id: string) => users.findActiveStaff(id);
  router.use(identityRouter(identity, findActiveStaff));
  const staff = requireStaff(findActiveStaff);
  const today = deps.today ?? (() => hotelToday());
  const catalog = new CatalogAdmin(deps.sequelize, today);
  router.use('/catalog', catalogAdminRouter(catalog, staff));
  router.use('/housekeeping', housekeepingRouter(new HousekeepingService(deps.sequelize), staff));
  router.use('/incidents', incidentRouter(new IncidentService(deps.sequelize, today), staff));
  router.use(availabilityRouter(new AvailabilityService(deps.sequelize, today), staff));
  router.use(reservationRouter(new ReservationService(deps.sequelize, today), staff));
  const now = deps.now ?? (() => new Date());
  const changes = new ReservationChanges(deps.sequelize, today, now);
  router.use(reservationChangeRouter(changes, staff));
  router.use(planningRouter(new PlanningService(deps.sequelize), staff));
  return router;
}

/** Public part of the API: no session, read-only catalogue for the public site. */
function publicRouter(deps: PublicDependencies): Router {
  const catalog = new PublicCatalog(
    new CatalogRepository(deps.sequelize),
    deps.today ?? (() => hotelToday()),
  );
  const router = Router();
  router.use(publicCatalogRouter(catalog));
  return router;
}

/**
 * Builds the Express application (architecture, section 7). The order matters:
 *  1. trace identifier and request log, so that every response, even an error, has one;
 *  2. security headers, CORS, overall rate limit, JSON body limited in size;
 *  3. routes;
 *  4. 404 for unknown addresses, then the single error handler, always last.
 *
 * The application does not listen on a port itself (see main.ts): the tests drive it directly.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy);

  app.use(requestContext(deps.logger));
  app.use(securityHeaders());
  app.use(corsPolicy(deps.allowedOrigins));
  app.use(rateLimiter(deps.globalRateLimit ?? GLOBAL_RATE_LIMIT));
  app.use(jsonBody());

  const api = Router();
  api.use(healthRouter(deps.checkDatabase, deps.logger));
  if (deps.admin !== undefined) {
    api.use('/admin', adminRouter(deps.admin, deps.logger));
  }
  if (deps.public !== undefined) {
    api.use('/public', publicRouter(deps.public));
  }
  deps.mountRoutes?.(api);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
