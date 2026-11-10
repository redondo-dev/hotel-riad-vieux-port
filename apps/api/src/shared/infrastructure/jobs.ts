import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';

/**
 * Background tasks of the API (step R-5b), with pg-boss: run in the same process as the API
 * (decision « 4a »), their state kept in PostgreSQL. pg-boss creates and updates its own schema
 * « pgboss » when it starts, and never touches the tables of the hotel. With several copies of
 * the API, each run is done by one copy only.
 *
 * Never started by the automated tests: they call the tasks themselves.
 */

/** Schema of pg-boss, apart from the tables of the hotel. */
const JOBS_SCHEMA = 'pgboss';

/** Bookings of the website not paid at the end of the hold of their rooms: every minute. */
export const UNPAID_EXPIRY_QUEUE = 'expire-unpaid-bookings';
const EVERY_MINUTE = '* * * * *';

/** Time left to a run in progress when the API stops. */
const STOP_TIMEOUT_MS = 8_000;

export interface Jobs {
  stop(): Promise<void>;
}

export async function startJobs(options: {
  connectionString: string;
  logger: Logger;
  /** One run of the expiry; an error is written to the log, the next minute tries again. */
  expireUnpaid: () => Promise<void>;
}): Promise<Jobs> {
  const { logger } = options;
  const boss = new PgBoss({ connectionString: options.connectionString, schema: JOBS_SCHEMA });
  boss.on('error', (error: unknown) => {
    logger.error({ err: error }, 'tâches de fond : erreur de pg-boss');
  });
  await boss.start();

  // Created at the first start only (null or undefined depending on the version of pg-boss).
  if (!(await boss.getQueue(UNPAID_EXPIRY_QUEUE))) {
    await boss.createQueue(UNPAID_EXPIRY_QUEUE);
  }
  await boss.schedule(UNPAID_EXPIRY_QUEUE, EVERY_MINUTE, {}, { tz: 'Europe/Paris' });
  await boss.work(UNPAID_EXPIRY_QUEUE, async () => {
    await options.expireUnpaid();
  });
  logger.info({ queue: UNPAID_EXPIRY_QUEUE }, 'tâches de fond démarrées (pg-boss)');

  return {
    async stop() {
      await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
    },
  };
}
