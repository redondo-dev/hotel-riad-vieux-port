/**
 * Starts the HTTP server of the API.
 *
 * Usage, from the repository root: npm run start:api (or npm run dev:api while developing,
 * which restarts on every change). Variables are read from the root .env file in development and
 * from the hosting's console in production.
 */
import { join } from 'node:path';
import pg from 'pg';
import { createApp, paymentLogOf } from './app.ts';
import { describeDatabase } from './config/database-url.ts';
import { DEFAULT_ADMIN_APP_URL, DEFAULT_PUBLIC_SITE_URL, loadEnv } from './config/env.ts';
import { OnlinePayments } from './modules/reservations/application/online-payments.ts';
import type { PaymentEventReader } from './modules/reservations/application/payment-events.ts';
import type { PaymentGateway } from './modules/reservations/application/payment-gateway.ts';
import { UnpaidExpiry } from './modules/reservations/application/unpaid-expiry.ts';
import { stripeEvents } from './modules/reservations/infrastructure/stripe-events.ts';
import {
  stripeClient,
  stripeGateway,
} from './modules/reservations/infrastructure/stripe-gateway.ts';
import { createSessionStore } from './shared/http/session.ts';
import { createSequelize } from './shared/infrastructure/database.ts';
import { createLogger } from './shared/infrastructure/logger.ts';
import { localFileStorage } from './shared/infrastructure/file-storage.ts';
import { type Jobs, startJobs } from './shared/infrastructure/jobs.ts';
import { type Mailer, outboxMailer } from './shared/infrastructure/mailer.ts';

/** Time left to the requests in progress when the hosting asks the API to stop. */
const SHUTDOWN_GRACE_MS = 10_000;

/** Development e-mails land here (repository root, ignored by Git). */
const OUTBOX_DIR = join(import.meta.dirname, '..', '..', '..', 'outbox');

/** Development photos land here (repository root, ignored by Git), unless STORAGE_DIR says. */
const DEFAULT_STORAGE_DIR = join(import.meta.dirname, '..', '..', '..', 'storage');

const env = loadEnv();
if (env.SESSION_SECRET === undefined) {
  throw new Error(
    'SESSION_SECRET est obligatoire pour démarrer l’API (32 caractères minimum) : voir .env.example.',
  );
}
const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });

function createMailer(): Mailer {
  if (env.NODE_ENV === 'production') {
    // The outbox writes secret links to disk: never in production. Brevo arrives in phase 6.
    throw new Error('Aucun service d’envoi d’e-mails n’est configuré pour la production.');
  }
  logger.info({ outbox: OUTBOX_DIR }, 'e-mails écrits dans le dossier outbox (développement)');
  return outboxMailer(OUTBOX_DIR);
}

/** Required in production by the configuration check; optional while developing. */
function createPayments(): { payments?: PaymentGateway; paymentEvents?: PaymentEventReader } {
  if (env.STRIPE_SECRET_KEY === undefined) {
    logger.warn('STRIPE_SECRET_KEY absente : la réservation en ligne répond « non configurée »');
    return {};
  }
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  if (env.STRIPE_WEBHOOK_SECRET === undefined) {
    logger.warn('STRIPE_WEBHOOK_SECRET absent : les réservations payées restent « en attente »');
    return { payments: stripeGateway(stripe) };
  }
  return {
    payments: stripeGateway(stripe),
    paymentEvents: stripeEvents(stripe, env.STRIPE_WEBHOOK_SECRET),
  };
}

const sequelize = createSequelize(env.DATABASE_URL);
// Required in production by the configuration check (loadEnv).
const storage = localFileStorage(env.STORAGE_DIR ?? DEFAULT_STORAGE_DIR);
const sessionPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
const paymentServices = createPayments();

const app = createApp({
  logger,
  allowedOrigins: env.API_ALLOWED_ORIGINS,
  trustProxy: env.TRUST_PROXY,
  checkDatabase: async () => {
    await sequelize.authenticate({ logging: false });
  },
  admin: {
    sequelize,
    sessionStore: createSessionStore(sessionPool, logger),
    sessionSecret: env.SESSION_SECRET,
    secureCookies: env.NODE_ENV === 'production',
    mailer: createMailer(),
    storage,
    adminAppUrl: env.ADMIN_APP_URL ?? DEFAULT_ADMIN_APP_URL,
  },
  public: {
    sequelize,
    storage,
    ...paymentServices,
    publicSiteUrl: env.PUBLIC_SITE_URL ?? DEFAULT_PUBLIC_SITE_URL,
  },
});

// Express 5 also calls this function when listening fails (port taken…): the error is then
// handled by server.on('error') below, and « API démarrée » must not be written.
const server = app.listen(env.API_PORT, (error?: Error) => {
  if (error !== undefined) {
    return;
  }
  logger.info(
    {
      port: env.API_PORT,
      environment: env.NODE_ENV,
      database: describeDatabase(env.DATABASE_URL),
      allowedOrigins: env.API_ALLOWED_ORIGINS,
    },
    'API démarrée',
  );
});

// Bookings of the website not paid in time: looked at every minute (step R-5b).
const expiry = new UnpaidExpiry({
  sequelize,
  payments: paymentServices.payments,
  settlement: new OnlinePayments({ sequelize, log: paymentLogOf(logger) }),
  now: () => new Date(),
  log: paymentLogOf(logger),
});
let jobs: Jobs | undefined;
startJobs({
  connectionString: env.DATABASE_URL,
  logger,
  expireUnpaid: async () => {
    try {
      const report = await expiry.run();
      if (report.confirmed + report.expired + report.kept > 0) {
        logger.info(report, 'réservations en ligne non payées à temps revues');
      }
    } catch (error) {
      logger.error({ err: error }, 'expiration des réservations non payées en erreur');
      throw error;
    }
  },
})
  .then((started) => {
    jobs = started;
  })
  .catch((error: unknown) => {
    // Without the task, the rooms of the unpaid bookings would stay held: never in production.
    logger.fatal({ err: error }, 'les tâches de fond n’ont pas pu démarrer');
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  });

server.on('error', (error) => {
  logger.fatal({ err: error }, 'le serveur HTTP n’a pas pu démarrer');
  process.exit(1);
});

let stopping = false;

/**
 * Stops accepting connections, lets the requests and the task in progress finish, then closes
 * the database.
 */
function shutdown(signal: string): void {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({ signal }, 'arrêt demandé : fin des requêtes en cours');
  setTimeout(() => {
    logger.error('arrêt forcé : des requêtes ne se sont pas terminées à temps');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
  server.close((error) => {
    (jobs?.stop() ?? Promise.resolve())
      .catch((stopError: unknown) => {
        logger.error({ err: stopError }, 'arrêt des tâches de fond en erreur');
      })
      .then(() => Promise.all([sequelize.close(), sessionPool.end()]))
      .catch((closeError: unknown) => {
        logger.error({ err: closeError }, 'fermeture de la base de données en erreur');
      })
      .finally(() => {
        logger.info('API arrêtée');
        process.exit(error === undefined ? 0 : 1);
      });
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});

// A programming error that escaped every handler: log it, then stop (the hosting restarts the
// API) rather than keep running in an unknown state.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'erreur non interceptée');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'promesse rejetée non interceptée');
  process.exit(1);
});
