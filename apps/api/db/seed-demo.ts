/**
 * Loads the DEMO data of the fictional Hôtel Riad Vieux-Port (portfolio): settings,
 * 5 categories, 85 rooms, seasons, services, and one staff account per role.
 *
 * Safety (decision P6):
 *   * refused unless DEMO_MODE=true — never run for a real hotel;
 *   * no password in the code or the repository: DEMO_USER_PASSWORD must be provided;
 *   * idempotent: running it twice creates nothing twice and never overwrites existing rows.
 *
 * Usage, from apps/api, after `npm run db:migrate`: npm run db:seed:demo
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import argon2 from 'argon2';
import { describeDatabase } from '../src/config/database-url.ts';
import { loadEnv } from '../src/config/env.ts';
import { createSequelize } from '../src/shared/infrastructure/database.ts';
import { runSqlFile } from './migrate.ts';

const SEEDS_DIR = join(import.meta.dirname, 'seeds', 'demo');

const DEMO_USERS = [
  {
    email: 'direction@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Direction',
    role: 'direction',
  },
  {
    email: 'reception@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Réception',
    role: 'reception',
  },
  {
    email: 'menage@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Ménage',
    role: 'housekeeping',
  },
  {
    email: 'technique@riad-vieux-port.example',
    firstName: 'Démo',
    lastName: 'Technique',
    role: 'technician',
  },
] as const;

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DEMO_MODE) {
    throw new Error(
      'Refusé : les données de démonstration ne se chargent que si DEMO_MODE=true ' +
        '(jamais pour un hôtel réel).',
    );
  }
  if (env.DEMO_USER_PASSWORD === undefined) {
    throw new Error(
      'DEMO_USER_PASSWORD est requis pour créer les comptes de démonstration ' +
        '(12 caractères minimum). Aucun mot de passe par défaut n’est prévu.',
    );
  }
  console.log(
    `Base ciblée : ${describeDatabase(env.DATABASE_URL)} (environnement : ${env.NODE_ENV})`,
  );

  const sequelize = createSequelize(env.DATABASE_URL);
  try {
    const files = (await readdir(SEEDS_DIR)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      await runSqlFile(sequelize, join(SEEDS_DIR, file));
      console.log(`  données chargées : ${file}`);
    }

    const passwordHash = await argon2.hash(env.DEMO_USER_PASSWORD);
    for (const user of DEMO_USERS) {
      // Parameterised query: values are never concatenated into the SQL text.
      await sequelize.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        { bind: [user.email, passwordHash, user.firstName, user.lastName, user.role] },
      );
      console.log(`  compte de démonstration : ${user.email} (${user.role})`);
    }
  } finally {
    await sequelize.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
