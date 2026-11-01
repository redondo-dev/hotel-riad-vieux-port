/**
 * Migration runner (Umzug). Usage, from apps/api:
 *   npm run db:status     list applied and pending migrations
 *   npm run db:migrate    apply every pending migration
 *   npm run db:rollback   revert the last migration (refused in production)
 *
 * Each migration is a pair of SQL files (`NNNN_name.up.sql` / `.down.sql`) run inside a single
 * transaction: it is applied entirely or not at all. Umzug records applied migrations in the
 * `schema_migrations` table. The target database is always printed before anything runs.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { describeDatabase } from '../src/config/database-url.ts';
import { loadEnv } from '../src/config/env.ts';
import { createSequelize } from '../src/shared/infrastructure/database.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export async function runSqlFile(sequelize: Sequelize, path: string): Promise<void> {
  const sql = await readFile(path, 'utf8');
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(sql, { transaction });
  });
}

export function createMigrator(sequelize: Sequelize): Umzug<Sequelize> {
  return new Umzug({
    migrations: {
      glob: ['*.up.sql', { cwd: MIGRATIONS_DIR }],
      resolve: ({ name, path }) => {
        if (path === undefined) {
          throw new Error(`Fichier introuvable pour la migration ${name}`);
        }
        const upPath = path;
        const downPath = path.replace(/\.up\.sql$/, '.down.sql');
        return {
          name: name.replace(/\.up\.sql$/, ''),
          up: () => runSqlFile(sequelize, upPath),
          down: () => runSqlFile(sequelize, downPath),
        };
      },
    },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize, tableName: 'schema_migrations' }),
    logger: undefined,
  });
}

async function main(command: string): Promise<void> {
  const env = loadEnv();
  console.log(
    `Base ciblée : ${describeDatabase(env.DATABASE_URL)} (environnement : ${env.NODE_ENV})`,
  );

  const sequelize = createSequelize(env.DATABASE_URL);
  const migrator = createMigrator(sequelize);
  try {
    switch (command) {
      case 'up': {
        const applied = await migrator.up();
        console.log(
          applied.length === 0
            ? 'Aucune migration en attente.'
            : applied.map((migration) => `  appliquée : ${migration.name}`).join('\n'),
        );
        break;
      }
      case 'down': {
        if (env.NODE_ENV === 'production') {
          throw new Error(
            "Refusé : l'annulation d'une migration est interdite en production " +
              '(elle supprimerait des données). Écrivez une nouvelle migration corrective.',
          );
        }
        const reverted = await migrator.down();
        console.log(
          reverted.length === 0
            ? 'Aucune migration à annuler.'
            : reverted.map((migration) => `  annulée : ${migration.name}`).join('\n'),
        );
        break;
      }
      case 'status': {
        const executed = await migrator.executed();
        const pending = await migrator.pending();
        console.log(
          `Appliquées (${executed.length}) : ${executed.map((m) => m.name).join(', ') || '—'}`,
        );
        console.log(
          `En attente (${pending.length}) : ${pending.map((m) => m.name).join(', ') || '—'}`,
        );
        break;
      }
      default:
        throw new Error(`Commande inconnue « ${command} ». Utilisez : up, down ou status.`);
    }
  } finally {
    await sequelize.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ?? 'status').catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
