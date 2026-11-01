/**
 * Starts the HTTP server of the API.
 *
 * Usage, from the repository root: npm run start:api (or npm run dev:api while developing,
 * which restarts on every change). Variables are read from the root .env file in development and
 * from the hosting's console in production.
 */
import { createApp } from './app.ts';
import { describeDatabase } from './config/database-url.ts';
import { loadEnv } from './config/env.ts';
import { createSequelize } from './shared/infrastructure/database.ts';
import { createLogger } from './shared/infrastructure/logger.ts';

/** Time left to the requests in progress when the hosting asks the API to stop. */
const SHUTDOWN_GRACE_MS = 10_000;

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });
const sequelize = createSequelize(env.DATABASE_URL);

const app = createApp({
  logger,
  allowedOrigins: env.API_ALLOWED_ORIGINS,
  trustProxy: env.TRUST_PROXY,
  checkDatabase: async () => {
    await sequelize.authenticate({ logging: false });
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
    sequelize
      .close()
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
