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
/** E-mails of confirmation of the bookings of the website (step R-6): every minute. */
export const CONFIRMATION_EMAIL_QUEUE = 'send-confirmation-emails';
/** E-mails of cancellation of the bookings of the website (step M): every minute. */
export const CANCELLATION_EMAIL_QUEUE = 'send-cancellation-emails';
const EVERY_MINUTE = '* * * * *';

/** Time left to a run in progress when the API stops. */
const STOP_TIMEOUT_MS = 8_000;

export interface Jobs {
  stop(): Promise<void>;
}

/** A task run every minute; an error is written to the log, the next minute tries again. */
export interface MinuteTask {
  queue: string;
  run: () => Promise<void>;
}

export async function startJobs(options: {
  connectionString: string;
  logger: Logger;
  tasks: readonly MinuteTask[];
}): Promise<Jobs> {
  const { logger } = options;
  const boss = new PgBoss({ connectionString: options.connectionString, schema: JOBS_SCHEMA });
  boss.on('error', (error: unknown) => {
    logger.error({ err: error }, 'tâches de fond : erreur de pg-boss');
  });
  await boss.start();

  for (const task of options.tasks) {
    // Created at the first start only (null or undefined depending on the version of pg-boss).
    if (!(await boss.getQueue(task.queue))) {
      await boss.createQueue(task.queue);
    }
    await boss.schedule(task.queue, EVERY_MINUTE, {}, { tz: 'Europe/Paris' });
    await boss.work(task.queue, async () => {
      await task.run();
    });
  }
  const queues = options.tasks.map((task) => task.queue);
  logger.info({ queues }, 'tâches de fond démarrées (pg-boss)');

  return {
    async stop() {
      await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
    },
  };
}
