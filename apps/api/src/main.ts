/**
 * Starts the HTTP server of the API.
 *
 * Usage, from the repository root: npm run start:api (or npm run dev:api while developing,
 * which restarts on every change). Variables are read from the root .env file in development and
 * from the hosting's console in production.
 */
import { join } from 'node:path';
import pg from 'pg';
import { createApp } from './app.ts';
import { describeDatabase } from './config/database-url.ts';
import { DEFAULT_ADMIN_APP_URL, loadEnv } from './config/env.ts';
import { createSessionStore } from './shared/http/session.ts';
import { createSequelize } from './shared/infrastructure/database.ts';
import { createLogger } from './shared/infrastructure/logger.ts';
import { type Mailer, outboxMailer } from './shared/infrastructure/mailer.ts';

/** Time left to the requests in progress when the hosting asks the API to stop. */
const SHUTDOWN_GRACE_MS = 10_000;

/** Development e-mails land here (repository root, ignored by Git). */
const OUTBOX_DIR = join(import.meta.dirname, '..', '..', '..', 'outbox');

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

const sequelize = createSequelize(env.DATABASE_URL);
const sessionPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });

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
    adminAppUrl: env.ADMIN_APP_URL ?? DEFAULT_ADMIN_APP_URL,
    demoPassword: env.DEMO_MODE ? env.DEMO_USER_PASSWORD : undefined,
  },
});

const server = app.listen(env.API_PORT, () => {
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

server.on('error', (error) => {
  logger.fatal({ err: error }, 'le serveur HTTP n’a pas pu démarrer');
  process.exit(1);
});

let stopping = false;

/** Stops accepting connections, lets the requests in progress finish, then closes the database. */
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
    Promise.all([sequelize.close(), sessionPool.end()])
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
