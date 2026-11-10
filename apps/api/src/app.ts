import express, { type Express, Router } from 'express';
import type { Logger } from 'pino';
import type { Sequelize } from 'sequelize';
import { CatalogAdmin } from './modules/catalog/application/catalog-admin.ts';
import { CategoryPhotos } from './modules/catalog/application/category-photos.ts';
import { PublicCatalog } from './modules/catalog/application/public-catalog.ts';
import { hotelToday } from './modules/catalog/domain/pricing.ts';
import { catalogAdminRouter } from './modules/catalog/http/catalog-admin-routes.ts';
import { mediaRouter, photoAdminRouter } from './modules/catalog/http/photo-routes.ts';
import { publicCatalogRouter } from './modules/catalog/http/public-catalog-routes.ts';
import { CatalogRepository } from './modules/catalog/infrastructure/catalog-repository.ts';
import { PhotoRepository } from './modules/catalog/infrastructure/photo-repository.ts';
import { DashboardService } from './modules/dashboard/application/dashboard-service.ts';
import { dashboardRouter } from './modules/dashboard/http/dashboard-routes.ts';
import { HousekeepingService } from './modules/housekeeping/application/housekeeping-service.ts';
import { housekeepingRouter } from './modules/housekeeping/http/housekeeping-routes.ts';
import { IncidentService } from './modules/incidents/application/incident-service.ts';
import { incidentRouter } from './modules/incidents/http/incident-routes.ts';
import { IdentityService } from './modules/identity/application/identity-service.ts';
import { requireStaff } from './modules/identity/http/guards.ts';
import { identityRouter } from './modules/identity/http/identity-routes.ts';
import { UserRepository } from './modules/identity/infrastructure/user-repository.ts';
import { AvailabilityService } from './modules/reservations/application/availability-service.ts';
import { FrontDesk } from './modules/reservations/application/front-desk.ts';
import { PlanningService } from './modules/reservations/application/planning-service.ts';
import { OnlineBooking } from './modules/reservations/application/online-booking.ts';
import { OnlinePayments } from './modules/reservations/application/online-payments.ts';
import type { PaymentEventReader } from './modules/reservations/application/payment-events.ts';
import type { PaymentGateway } from './modules/reservations/application/payment-gateway.ts';
import { PublicAvailability } from './modules/reservations/application/public-availability.ts';
import { ReservationChanges } from './modules/reservations/application/reservation-changes.ts';
import { ReservationService } from './modules/reservations/application/reservation-service.ts';
import { availabilityRouter } from './modules/reservations/http/availability-routes.ts';
import { frontDeskRouter } from './modules/reservations/http/front-desk-routes.ts';
import { paymentWebhookRouter } from './modules/reservations/http/payment-webhook-routes.ts';
import { planningRouter } from './modules/reservations/http/planning-routes.ts';
import { publicSearchRouter } from './modules/reservations/http/public-availability-routes.ts';
import { publicBookingRouter } from './modules/reservations/http/public-booking-routes.ts';
import { reservationChangeRouter } from './modules/reservations/http/reservation-change-routes.ts';
import { reservationRouter } from './modules/reservations/http/reservation-routes.ts';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.ts';
import { type DatabaseCheck, healthRouter } from './shared/http/health.ts';
import { GLOBAL_RATE_LIMIT, type RateLimitRule, rateLimiter } from './shared/http/rate-limit.ts';
import { requestContext } from './shared/http/request-context.ts';
import { corsPolicy, jsonBody, securityHeaders } from './shared/http/security.ts';
import { type SessionStore, staffSessions } from './shared/http/session.ts';
import type { FileStorage } from './shared/infrastructure/file-storage.ts';
import type { Mailer } from './shared/infrastructure/mailer.ts';
import { DEFAULT_PUBLIC_SITE_URL } from './config/env.ts';

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
  /** Files of the photos (GET /public/media/…); left out by the tests that do not need them. */
  storage?: FileStorage;
  /** Current day at the hotel, « YYYY-MM-DD »; the tests fix it. Default: the real clock. */
  today?: () => string;
  /** Current instant (online booking limits, RM-06); the tests fix it. Default: the real clock. */
  now?: () => Date;
  /** Stripe, or a fake in the tests; without it, online bookings answer 503. */
  payments?: PaymentGateway;
  /** Address of the public site: the payment page may only send visitors back there. */
  publicSiteUrl?: string;
  /**
   * Notifications of Stripe, or a fake in the tests (step R-5); without it (no webhook secret
   * in development), POST /webhooks/stripe does not exist and bookings stay « en attente ».
   */
  paymentEvents?: PaymentEventReader;
}

export interface AdminDependencies {
  sequelize: Sequelize;
  sessionStore: SessionStore;
  sessionSecret: string;
  /** True in production: session cookie sent over HTTPS only. */
  secureCookies: boolean;
  mailer: Mailer;
  /** Files of the photos; without it, the photo routes are not offered. */
  storage?: FileStorage;
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
  if (deps.storage !== undefined) {
    const photos = new CategoryPhotos(deps.sequelize, deps.storage);
    router.use('/catalog', photoAdminRouter(photos, staff));
  }
  router.use('/housekeeping', housekeepingRouter(new HousekeepingService(deps.sequelize), staff));
  router.use('/incidents', incidentRouter(new IncidentService(deps.sequelize, today), staff));
  router.use(availabilityRouter(new AvailabilityService(deps.sequelize, today), staff));
  router.use(reservationRouter(new ReservationService(deps.sequelize, today), staff));
  const now = deps.now ?? (() => new Date());
  const changes = new ReservationChanges(deps.sequelize, today, now);
  router.use(reservationChangeRouter(changes, staff));
  router.use(planningRouter(new PlanningService(deps.sequelize), staff));
  router.use(frontDeskRouter(new FrontDesk(deps.sequelize, today), staff, today));
  router.use(dashboardRouter(new DashboardService(deps.sequelize, today), staff, today));
  return router;
}

/** Public part of the API: no session; catalogue and availability for the public site. */
function publicRouter(deps: PublicDependencies, logger: Logger): Router {
  const catalog = new PublicCatalog(
    new CatalogRepository(deps.sequelize),
    deps.today ?? (() => hotelToday()),
    new PhotoRepository(deps.sequelize),
  );
  const router = Router();
  router.use(publicCatalogRouter(catalog));
  const now = deps.now ?? (() => new Date());
  router.use(publicSearchRouter(new PublicAvailability(deps.sequelize, now)));
  const today = deps.today ?? (() => hotelToday());
  const booking = new OnlineBooking({
    sequelize: deps.sequelize,
    reservations: new ReservationService(deps.sequelize, today),
    payments: deps.payments,
    siteUrl: deps.publicSiteUrl ?? DEFAULT_PUBLIC_SITE_URL,
    now,
    logError: (error) => {
      logger.error({ err: error }, 'Stripe : ouverture de la page de paiement impossible');
    },
  });
  router.use(publicBookingRouter(booking));
  if (deps.storage !== undefined) {
    router.use(mediaRouter(deps.storage));
  }
  return router;
}

/**
 * Builds the Express application (architecture, section 7). The order matters:
 *  1. trace identifier and request log, so that every response, even an error, has one;
 *  2. security headers, CORS, overall rate limit;
 *  3. notifications of Stripe, read as raw bytes for their signature: before the JSON reader;
 *  4. JSON body limited in size, then the routes;
 *  5. 404 for unknown addresses, then the single error handler, always last.
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
  const paymentEvents = deps.public?.paymentEvents;
  if (deps.public !== undefined && paymentEvents !== undefined) {
    const { logger } = deps;
    const payments = new OnlinePayments({
      sequelize: deps.public.sequelize,
      log: {
        warn: (details, message) => {
          logger.warn(details, message);
        },
        error: (details, message) => {
          logger.error(details, message);
        },
      },
    });
    app.use(API_PREFIX, paymentWebhookRouter(paymentEvents, payments));
  }
  app.use(jsonBody());

  const api = Router();
  api.use(healthRouter(deps.checkDatabase, deps.logger));
  if (deps.admin !== undefined) {
    api.use('/admin', adminRouter(deps.admin, deps.logger));
  }
  if (deps.public !== undefined) {
    api.use('/public', publicRouter(deps.public, deps.logger));
  }
  deps.mountRoutes?.(api);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
