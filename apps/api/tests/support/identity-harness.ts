import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { QueryTypes, type Sequelize } from 'sequelize';
import request from 'supertest';
import { API_PREFIX, createApp } from '../../src/app.ts';
import type { Role } from '../../src/modules/identity/domain/identity-rules.ts';
import type { PaymentGateway } from '../../src/modules/reservations/application/payment-gateway.ts';
import { hashPassword } from '../../src/modules/identity/infrastructure/password-hasher.ts';
import { createSessionStore } from '../../src/shared/http/session.ts';
import { createSequelize } from '../../src/shared/infrastructure/database.ts';
import {
  type FileStorage,
  localFileStorage,
} from '../../src/shared/infrastructure/file-storage.ts';
import { createLogger } from '../../src/shared/infrastructure/logger.ts';
import type { MailMessage } from '../../src/shared/infrastructure/mailer.ts';
import { testDatabaseUrl } from './test-database.ts';

/** Builds the API with its staff part, on the test database, with e-mails kept in memory. */

export const ADMIN = `${API_PREFIX}/admin`;
export const ADMIN_APP_URL = 'http://localhost:4300';
export const STRONG_PASSWORD = 'Vieux-Port-2026!';

export const PUBLIC_SITE_URL = 'http://localhost:4200';

export interface AppOptions {
  today?: () => string;
  now?: () => Date;
  /** A fake payment service: the tests never call Stripe. */
  payments?: PaymentGateway;
}

export interface TestStaff {
  id: string;
  email: string;
  password: string;
}

export class IdentityHarness {
  readonly sequelize: Sequelize;
  readonly #pool: pg.Pool;
  /** Every e-mail « sent » since the harness was created. */
  readonly mails: MailMessage[] = [];
  /** Photos stored by the tests: a folder of their own, removed by close(). */
  readonly #storageDir = join(tmpdir(), `riad-test-${randomUUID()}`);
  readonly storage: FileStorage = localFileStorage(this.#storageDir);

  constructor() {
    this.sequelize = createSequelize(testDatabaseUrl);
    this.#pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 3 });
  }

  /**
   * A NEW application each time: its rate-limit counters start from zero. `today` fixes the
   * current day at the hotel (« YYYY-MM-DD ») and `now` the current instant; by default, the
   * real clock.
   */
  app(options: AppOptions = {}): ReturnType<typeof createApp> {
    const logger = createLogger({ level: 'silent', pretty: false });
    return createApp({
      logger,
      allowedOrigins: [],
      trustProxy: 0,
      checkDatabase: async () => undefined,
      admin: {
        sequelize: this.sequelize,
        sessionStore: createSessionStore(this.#pool, logger, { pruneExpired: false }),
        sessionSecret: 'secret-de-session-reserve-aux-tests-automatises',
        secureCookies: false,
        mailer: {
          send: async (message) => {
            this.mails.push(message);
          },
        },
        adminAppUrl: ADMIN_APP_URL,
        storage: this.storage,
        ...(options.today === undefined ? {} : { today: options.today }),
        ...(options.now === undefined ? {} : { now: options.now }),
      },
      public: {
        sequelize: this.sequelize,
        storage: this.storage,
        ...(options.today === undefined ? {} : { today: options.today }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.payments === undefined ? {} : { payments: options.payments }),
        publicSiteUrl: PUBLIC_SITE_URL,
      },
    });
  }

  /** Creates an account directly in the database, with a known password. */
  async createStaff(role: Role, options: { isActive?: boolean } = {}): Promise<TestStaff> {
    const email = `${role}-${randomUUID().slice(0, 8)}@test.example`;
    const rows = await this.sequelize.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'Test', $3, $4, $5) RETURNING id`,
      {
        bind: [email, await hashPassword(STRONG_PASSWORD), role, role, options.isActive ?? true],
        type: QueryTypes.SELECT,
      },
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('compte de test non créé');
    }
    return { id, email, password: STRONG_PASSWORD };
  }

  async rows<T extends object>(sql: string, bind: unknown[] = []): Promise<T[]> {
    return this.sequelize.query<T>(sql, { bind, type: QueryTypes.SELECT });
  }

  async execute(sql: string, bind: unknown[] = []): Promise<void> {
    await this.sequelize.query(sql, { bind });
  }

  /** The token of the last link e-mailed to `email`. */
  lastLinkToken(email: string): string {
    const mail = this.mails.filter((message) => message.to === email).at(-1);
    const token = /#jeton=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1];
    if (token === undefined) {
      throw new Error(`aucun lien envoyé à ${email}`);
    }
    return token;
  }

  async close(): Promise<void> {
    await Promise.all([this.sequelize.close(), this.#pool.end()]);
    await rm(this.#storageDir, { recursive: true, force: true });
  }
}

/** Logs in with a cookie-keeping agent; returns the agent and its anti-CSRF token. */
export async function logIn(
  app: ReturnType<typeof createApp>,
  staff: { email: string; password: string },
): Promise<{ agent: ReturnType<typeof request.agent>; csrfToken: string }> {
  const agent = request.agent(app);
  const response = await agent
    .post(`${ADMIN}/session`)
    .send({ email: staff.email, password: staff.password });
  if (response.status !== 200) {
    throw new Error(`connexion de test refusée (${response.status}) : ${response.text}`);
  }
  return { agent, csrfToken: String(response.body.csrfToken) };
}
